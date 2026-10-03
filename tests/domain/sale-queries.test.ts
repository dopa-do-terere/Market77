import { beforeEach, describe, expect, it } from "vitest";
import { adminSql } from "@/db/client";
import { withOrg } from "@/db/tenant";
import { confirmPayment, startPayment } from "@/domain/payments";
import { getSaleDetail, listRecentSales, salesToday } from "@/domain/sale-queries";
import { addItemByBarcode } from "@/domain/sales";
import { fakeProvider } from "@/payments/fake";
import { makeOrg, resetDb, seedPayment, seedSale, seedSellable, seedStore } from "../helpers";

beforeEach(resetDb);

const NOW = new Date("2026-10-02T12:00:00Z");

async function sold(orgId: string, store: { marketId: string; terminalId: string }, barcode: string, at = NOW) {
  const sale = await withOrg(orgId, (tx) => addItemByBarcode(tx, orgId, store, { barcode }, at));
  return sale.id;
}

async function setup(price = 500) {
  const orgId = await makeOrg("A");
  const store = await seedStore(orgId);
  await seedSellable(orgId, store.marketId, { barcode: "B-1", priceCents: price });
  return { orgId, store };
}

async function paid(orgId: string, store: { marketId: string; terminalId: string }, paidAt: Date) {
  const id = await sold(orgId, store, "B-1");
  const view = await withOrg(orgId, (tx) => startPayment(tx, orgId, store, id, fakeProvider, NOW));
  await withOrg(orgId, (tx) => confirmPayment(tx, view.payment!.id, view.totalCents, {}, paidAt));
  return id;
}

describe("listRecentSales", () => {
  it("lists newest first with item counts, skipping empty carts, and honors the limit", async () => {
    const { orgId, store } = await setup();
    await sold(orgId, store, "B-1");
    await sold(orgId, store, "B-1");
    await adminSql`insert into sales (org_id, market_id, terminal_id, expires_at) values (${orgId}, ${store.marketId}, ${store.terminalId}, now())`;
    const all = await withOrg(orgId, (tx) => listRecentSales(tx));
    expect(all).toHaveLength(2);
    expect(all[0].createdAt.getTime()).toBeGreaterThanOrEqual(all[1].createdAt.getTime());
    expect([all[0].marketName, all[0].status, all[0].itemCount, all[0].totalCents]).toEqual(["Loja", "open", 1, 500]);
    expect(await withOrg(orgId, (tx) => listRecentSales(tx, 1))).toHaveLength(1);
  });

  it("lists an itemless sale that has a payment and flags failed ones, but not one with neither", async () => {
    const { orgId, store } = await setup();
    await sold(orgId, store, "B-1");
    const failed = await seedSale(orgId);
    await seedPayment(orgId, failed.saleId, { status: "failed" });
    await seedSale(orgId); // no items, no payments
    const all = await withOrg(orgId, (tx) => listRecentSales(tx));
    expect(all).toHaveLength(2);
    expect(all.find((r) => r.id === failed.saleId)?.needsAttention).toBe(true);
    expect(all.filter((r) => r.id !== failed.saleId).map((r) => r.needsAttention)).toEqual([false]);
  });

  it("does not list another tenant's sales", async () => {
    const a = await setup();
    const b = await setup();
    await sold(b.orgId, b.store, "B-1");
    expect(await withOrg(a.orgId, (tx) => listRecentSales(tx))).toHaveLength(0);
  });
});

describe("getSaleDetail", () => {
  it("returns the items and a failed payment with expected and received amounts", async () => {
    const { orgId, store } = await setup();
    const id = await sold(orgId, store, "B-1");
    const view = await withOrg(orgId, (tx) => startPayment(tx, orgId, store, id, fakeProvider, NOW));
    await withOrg(orgId, (tx) => confirmPayment(tx, view.payment!.id, 499, {}, NOW));
    const d = await withOrg(orgId, (tx) => getSaleDetail(tx, id));
    expect(d?.items).toEqual([{ productName: "Água", quantity: 1, unitPriceCents: 500 }]);
    expect(d?.payments.map((p) => [p.status, p.amountCents, p.paidAmountCents])).toEqual([["failed", 500, 499]]);
  });

  it("does not overflow on a huge provider-reported amount", async () => {
    const { orgId, store } = await setup();
    const id = await sold(orgId, store, "B-1");
    await withOrg(orgId, (tx) => startPayment(tx, orgId, store, id, fakeProvider, NOW));
    await adminSql`update payments set webhook_payload = '{"paidAmountCents": 99999999999}'::jsonb where sale_id = ${id}`;
    const d = await withOrg(orgId, (tx) => getSaleDetail(tx, id));
    expect(d?.payments[0].paidAmountCents).toBe(99999999999);
  });

  it("returns null for a malformed id and for another tenant's sale", async () => {
    const a = await setup();
    const b = await setup();
    const id = await sold(a.orgId, a.store, "B-1");
    expect(await withOrg(a.orgId, (tx) => getSaleDetail(tx, "nope"))).toBeNull();
    expect(await withOrg(b.orgId, (tx) => getSaleDetail(tx, id))).toBeNull();
  });
});

describe("salesToday", () => {
  it("counts paid sales of the current day in the market's own time zone", async () => {
    const { orgId, store } = await setup();
    // America/Sao_Paulo is UTC-3. "now" is 23:00 on Oct 2 there, already Oct 3 in UTC.
    const now = new Date("2026-10-03T02:00:00Z");
    await paid(orgId, store, new Date("2026-10-02T12:00:00Z")); // Oct 2 in Sao Paulo: counts
    await paid(orgId, store, new Date("2026-10-03T01:30:00Z")); // 22:30 Oct 2 in Sao Paulo: counts
    await paid(orgId, store, new Date("2026-10-02T02:30:00Z")); // 23:30 Oct 1 in Sao Paulo: does not
    await sold(orgId, store, "B-1"); // open sale: does not count
    expect(await withOrg(orgId, (tx) => salesToday(tx, now))).toEqual({ totalCents: 1000, count: 2 });
  });

  it("returns zero when nothing was sold", async () => {
    const { orgId } = await setup();
    expect(await withOrg(orgId, (tx) => salesToday(tx, NOW))).toEqual({ totalCents: 0, count: 0 });
  });
});
