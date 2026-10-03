import { beforeEach, describe, expect, it } from "vitest";
import { adminSql } from "@/db/client";
import { withOrg } from "@/db/tenant";
import { confirmPayment, startPayment } from "@/domain/payments";
import { addItemByBarcode, getSaleView, setItemQuantity } from "@/domain/sales";
import { getBalance, recordMovement } from "@/domain/stock";
import { fakeProvider } from "@/payments/fake";
import type { PaymentProvider } from "@/payments/provider";
import { codeOf, makeOrg, resetDb, seedSellable, seedStore } from "../helpers";

beforeEach(resetDb);

const NOW = new Date("2026-10-02T12:00:00Z");
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);
const BARCODE = "7891000100103";

/** An open sale with two units of one R$ 5,00 product (total 1000). */
async function ready() {
  const orgId = await makeOrg("A");
  const store = await seedStore(orgId);
  const item = await seedSellable(orgId, store.marketId, { barcode: BARCODE, priceCents: 500 });
  const first = await withOrg(orgId, (tx) => addItemByBarcode(tx, orgId, store, { barcode: BARCODE }, NOW));
  await withOrg(orgId, (tx) => addItemByBarcode(tx, orgId, store, { saleId: first.id, barcode: BARCODE }, NOW));
  return { orgId, store, item, saleId: first.id };
}
type Ready = Awaited<ReturnType<typeof ready>>;

const pay = (r: Ready, now = NOW, provider: PaymentProvider = fakeProvider) =>
  withOrg(r.orgId, (tx) => startPayment(tx, r.orgId, r.store, r.saleId, provider, now));
const confirm = (r: Ready, paymentId: string, amount = 1000, now = NOW) =>
  withOrg(r.orgId, (tx) => confirmPayment(tx, paymentId, amount, { test: true }, now));
const payments = async (r: Ready) =>
  adminSql`select id, status, external_id from payments where sale_id = ${r.saleId} order by created_at, id`;
const saleStatus = async (r: Ready) =>
  (await adminSql`select status from sales where id = ${r.saleId}`)[0].status as string;
const movements = async (r: Ready) =>
  (await adminSql`select count(*)::int as n from stock_movements where sale_id = ${r.saleId}`)[0].n as number;
const balance = (r: Ready) => withOrg(r.orgId, (tx) => getBalance(tx, r.item.marketProductId));

describe("startPayment", () => {
  it("creates a pending payment for the frozen total and moves the sale to awaiting_payment", async () => {
    const r = await ready();
    const view = await pay(r);
    expect(view.status).toBe("awaiting_payment");
    expect([view.payment?.status, view.payment?.amountCents]).toEqual(["pending", 1000]);
    expect(view.payment?.qrPayload).toMatch(/^FAKEPIX\|/);
    expect(view.payment?.expiresAt).toEqual(minutes(3));
  });

  it("returns the same QR when called again while it is still valid", async () => {
    const r = await ready();
    const a = await pay(r);
    const b = await pay(r, minutes(1));
    expect(b.payment?.qrPayload).toBe(a.payment?.qrPayload);
    expect(await payments(r)).toHaveLength(1);
  });

  it("issues a new QR after the old one expired and marks the old payment expired", async () => {
    const r = await ready();
    const a = await pay(r);
    const b = await pay(r, minutes(4));
    expect(b.payment?.qrPayload).not.toBe(a.payment?.qrPayload);
    expect((await payments(r)).map((p) => p.status)).toEqual(["expired", "pending"]);
  });

  it("rejects an empty sale", async () => {
    const r = await ready();
    const view = await withOrg(r.orgId, (tx) => getSaleView(tx, r.saleId));
    await withOrg(r.orgId, (tx) =>
      setItemQuantity(tx, r.store, r.saleId, { itemId: view.items[0].id, quantity: 0 }, NOW),
    );
    expect(await codeOf(pay(r))).toBe("sale_empty");
  });

  it("locks the cart while awaiting payment and refuses to pay a paid sale again", async () => {
    const r = await ready();
    await pay(r);
    const scan = () =>
      withOrg(r.orgId, (tx) => addItemByBarcode(tx, r.orgId, r.store, { saleId: r.saleId, barcode: BARCODE }, NOW));
    expect(await codeOf(scan())).toBe("sale_not_editable");
    const [p] = await payments(r);
    await confirm(r, p.id as string);
    expect(await codeOf(pay(r))).toBe("sale_not_editable");
  });

  it("maps a provider failure to provider_unavailable and leaves the sale open", async () => {
    const r = await ready();
    const broken: PaymentProvider = {
      ...fakeProvider,
      createPixCharge: async () => {
        throw new Error("provider down");
      },
    };
    expect(await codeOf(pay(r, NOW, broken))).toBe("provider_unavailable");
    expect(await saleStatus(r)).toBe("open");
    expect(await payments(r)).toHaveLength(0);
  });
});

describe("confirmPayment", () => {
  it("marks the sale paid and takes each item out of stock, allowing a negative balance", async () => {
    const r = await ready();
    await pay(r);
    const [p] = await payments(r);
    expect(await confirm(r, p.id as string)).toBe("confirmed");
    expect(await saleStatus(r)).toBe("paid");
    expect(await movements(r)).toBe(1);
    expect(await balance(r)).toBe(-2);
    const [paid] = await adminSql`select paid_at from sales where id = ${r.saleId}`;
    expect(paid.paid_at).toEqual(NOW);
  });

  it("subtracts from existing stock", async () => {
    const r = await ready();
    await withOrg(r.orgId, (tx) =>
      recordMovement(tx, r.orgId, null, { marketProductId: r.item.marketProductId, type: "in", quantity: 10 }),
    );
    await pay(r);
    const [p] = await payments(r);
    await confirm(r, p.id as string);
    expect(await balance(r)).toBe(8);
  });

  it("is idempotent: confirming twice moves stock once", async () => {
    const r = await ready();
    await pay(r);
    const [p] = await payments(r);
    expect(await confirm(r, p.id as string)).toBe("confirmed");
    expect(await confirm(r, p.id as string)).toBe("already_confirmed");
    expect(await movements(r)).toBe(1);
    expect(await balance(r)).toBe(-2);
  });

  it("confirms exactly once when twenty confirmations race", async () => {
    const r = await ready();
    await pay(r);
    const [p] = await payments(r);
    const results = await Promise.all(Array.from({ length: 20 }, () => confirm(r, p.id as string)));
    expect(results.filter((x) => x === "confirmed")).toHaveLength(1);
    expect(results.filter((x) => x === "already_confirmed")).toHaveLength(19);
    expect(await movements(r)).toBe(1);
    expect(await balance(r)).toBe(-2);
  });

  it.each(["open", "expired"])("still confirms a late payment when the sale went back to %s", async (status) => {
    const r = await ready();
    await pay(r);
    const [p] = await payments(r);
    await adminSql`update payments set status = 'expired' where id = ${p.id}`;
    await adminSql`update sales set status = ${status} where id = ${r.saleId}`;
    expect(await confirm(r, p.id as string)).toBe("confirmed");
    expect(await saleStatus(r)).toBe("paid");
    expect(await balance(r)).toBe(-2);
  });

  it("rejects a payment for a cancelled sale, keeps it visible as failed and moves no stock", async () => {
    const r = await ready();
    await pay(r);
    const [p] = await payments(r);
    await adminSql`update payments set status = 'expired' where id = ${p.id}`;
    await adminSql`update sales set status = 'cancelled' where id = ${r.saleId}`;
    expect(await confirm(r, p.id as string)).toBe("rejected");
    expect((await payments(r))[0].status).toBe("failed");
    expect(await saleStatus(r)).toBe("cancelled");
    expect(await movements(r)).toBe(0);
  });

  it("rejects a different paid amount and records what was paid", async () => {
    const r = await ready();
    await pay(r);
    const [p] = await payments(r);
    expect(await confirm(r, p.id as string, 999)).toBe("rejected");
    expect((await payments(r))[0].status).toBe("failed");
    expect(await saleStatus(r)).toBe("awaiting_payment");
    expect(await movements(r)).toBe(0);
    const [row] = await adminSql`select webhook_payload->>'paidAmountCents' as paid from payments where id = ${p.id}`;
    expect(row.paid).toBe("999");
  });

  it("rejects a second payment for a sale that is already paid, without a second stock movement", async () => {
    const r = await ready();
    await pay(r);
    const [first] = await payments(r);
    await confirm(r, first.id as string);
    const [second] = await adminSql`
      insert into payments (org_id, sale_id, provider, external_id, amount_cents, qr_payload, expires_at, status)
      values (${r.orgId}, ${r.saleId}, 'fake', 'late-qr', 1000, 'qr', now(), 'expired') returning id`;
    expect(await confirm(r, second.id as string)).toBe("rejected");
    expect(await movements(r)).toBe(1);
    expect(await balance(r)).toBe(-2);
  });

  it("answers not_found for an unknown payment", async () => {
    const r = await ready();
    expect(await codeOf(confirm(r, "6f1d3c9e-0000-4000-8000-000000000000"))).toBe("not_found");
  });
});
