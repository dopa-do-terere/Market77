import { beforeEach, describe, expect, it } from "vitest";
import { adminSql } from "@/db/client";
import { withOrg } from "@/db/tenant";
import { startPayment } from "@/domain/payments";
import { CHECK_INTERVAL_MS, refreshSale } from "@/domain/refresh";
import { listRecentSales } from "@/domain/sale-queries";
import { addItemByBarcode } from "@/domain/sales";
import { getBalance } from "@/domain/stock";
import { buildFakeWebhook, fakeProvider } from "@/payments/fake";
import { type PaymentProvider, providerTimeout } from "@/payments/provider";
import { makeOrg, resetDb, seedSellable, seedStore } from "../helpers";

beforeEach(resetDb);

const NOW = new Date("2026-10-02T12:00:00Z");
const at = (ms: number) => new Date(NOW.getTime() + ms);
const BARCODE = "7891000100103";

async function awaiting() {
  const orgId = await makeOrg("A");
  const store = await seedStore(orgId);
  const item = await seedSellable(orgId, store.marketId, { barcode: BARCODE, priceCents: 500 });
  const sale = await withOrg(orgId, (tx) => addItemByBarcode(tx, orgId, store, { barcode: BARCODE }, NOW));
  const view = await withOrg(orgId, (tx) => startPayment(tx, orgId, store, sale.id, fakeProvider, NOW));
  const externalId = view.payment!.qrPayload!.split("|")[1];
  const refresh = (now: Date, provider: PaymentProvider = fakeProvider) =>
    withOrg(orgId, (tx) => refreshSale(tx, store, sale.id, provider, now));
  return { orgId, store, item, saleId: sale.id, externalId, refresh };
}

const counting = () => {
  const calls = { n: 0 };
  const provider: PaymentProvider = {
    ...fakeProvider,
    getCharge: async (id) => {
      calls.n++;
      return fakeProvider.getCharge(id);
    },
  };
  return { calls, provider };
};

describe("refreshSale", () => {
  it("pays the sale when the provider says the charge is confirmed", async () => {
    const r = await awaiting();
    buildFakeWebhook(r.externalId, { status: "confirmed" });
    const view = await r.refresh(at(CHECK_INTERVAL_MS));
    expect(view.status).toBe("paid");
    expect(await withOrg(r.orgId, (tx) => getBalance(tx, r.item.marketProductId))).toBe(-1);
  });

  it("keeps waiting while the charge is pending and asks the provider at most once per interval", async () => {
    const r = await awaiting();
    const { calls, provider } = counting();
    expect((await r.refresh(at(1000), provider)).status).toBe("awaiting_payment");
    expect(calls.n).toBe(1);
    await r.refresh(at(5000), provider);
    expect(calls.n).toBe(1);
    await r.refresh(at(1000 + CHECK_INTERVAL_MS), provider);
    expect(calls.n).toBe(2);
  });

  it("expires the payment and reopens the sale with the cart intact once the QR is old", async () => {
    const r = await awaiting();
    const view = await r.refresh(at(4 * 60_000));
    expect(view.status).toBe("open");
    expect(view.items).toHaveLength(1);
    expect(view.payment?.status).toBe("expired");
    expect(view.expiresAt).toEqual(at(4 * 60_000 + 5 * 60_000));
    const again = await withOrg(r.orgId, (tx) => startPayment(tx, r.orgId, r.store, r.saleId, fakeProvider, at(4 * 60_000)));
    expect(again.status).toBe("awaiting_payment");
    expect(again.payment?.qrPayload).not.toBe(view.payment?.qrPayload);
  });

  it("expires the payment early when the provider reports it expired", async () => {
    const r = await awaiting();
    buildFakeWebhook(r.externalId, { status: "expired" });
    const view = await r.refresh(at(CHECK_INTERVAL_MS));
    expect([view.status, view.payment?.status]).toEqual(["open", "expired"]);
  });

  it("reopens the sale when the provider reports the charge failed", async () => {
    const r = await awaiting();
    buildFakeWebhook(r.externalId, { status: "failed" });
    const view = await r.refresh(at(CHECK_INTERVAL_MS));
    expect([view.status, view.payment?.status]).toEqual(["open", "failed"]);
  });

  it("keeps a failed Pix without a reason so the owner sees it needs attention", async () => {
    const r = await awaiting();
    buildFakeWebhook(r.externalId, { status: "failed" });
    await r.refresh(at(CHECK_INTERVAL_MS));
    const [p] = await adminSql`select status, failure_reason from payments where sale_id = ${r.saleId}`;
    expect([p.status, p.failure_reason]).toEqual(["failed", null]);
    expect((await withOrg(r.orgId, (tx) => listRecentSales(tx)))[0].needsAttention).toBe(true);
  });

  it("does not crash or confirm when the provider is down", async () => {
    const r = await awaiting();
    const down: PaymentProvider = {
      ...fakeProvider,
      getCharge: async () => {
        throw new Error("provider down");
      },
    };
    expect((await r.refresh(at(CHECK_INTERVAL_MS), down)).status).toBe("awaiting_payment");
    const [pay] = await adminSql`select status from payments where sale_id = ${r.saleId}`;
    expect(pay.status).toBe("pending");
    const [mv] = await adminSql`select count(*)::int as n from stock_movements where sale_id = ${r.saleId}`;
    expect(mv.n).toBe(0);
    expect((await r.refresh(at(4 * 60_000), down)).status).toBe("open");
  });

  it("does not hang when the provider never answers", async () => {
    const r = await awaiting();
    const hung: PaymentProvider = { ...fakeProvider, getCharge: () => new Promise(() => {}) };
    providerTimeout.ms = 50;
    try {
      expect((await r.refresh(at(CHECK_INTERVAL_MS), hung)).status).toBe("awaiting_payment");
      expect((await r.refresh(at(4 * 60_000), hung)).status).toBe("open");
    } finally {
      providerTimeout.ms = 5000;
    }
  });

  it("reopens at once when the confirmed payment is rejected", async () => {
    const r = await awaiting();
    await adminSql`update sales set total_cents = 700 where id = ${r.saleId}`;
    buildFakeWebhook(r.externalId, { status: "confirmed" });
    const view = await r.refresh(at(CHECK_INTERVAL_MS));
    expect([view.status, view.payment?.status]).toEqual(["open", "failed"]);
    const [mv] = await adminSql`select count(*)::int as n from stock_movements where sale_id = ${r.saleId}`;
    expect(mv.n).toBe(0);
  });

  it("returns an awaiting sale with no pending payment to open", async () => {
    const r = await awaiting();
    await adminSql`update payments set status = 'failed' where sale_id = ${r.saleId}`;
    expect((await r.refresh(at(1000))).status).toBe("open");
  });

  it("expires an abandoned cart and persists it", async () => {
    const orgId = await makeOrg("A");
    const store = await seedStore(orgId);
    await seedSellable(orgId, store.marketId, { barcode: BARCODE });
    const sale = await withOrg(orgId, (tx) => addItemByBarcode(tx, orgId, store, { barcode: BARCODE }, NOW));
    const view = await withOrg(orgId, (tx) => refreshSale(tx, store, sale.id, fakeProvider, at(6 * 60_000)));
    expect(view.status).toBe("expired");
    const [row] = await adminSql`select status from sales where id = ${sale.id}`;
    expect(row.status).toBe("expired");
  });
});
