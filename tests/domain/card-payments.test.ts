import { beforeEach, describe, expect, it, vi } from "vitest";
import { adminSql } from "@/db/client";
import { withOrg } from "@/db/tenant";
import { CARD_TTL_MS, cancelPayment, confirmPayment, failPayment, startPayment } from "@/domain/payments";
import { addItemByBarcode } from "@/domain/sales";
import { getBalance } from "@/domain/stock";
import type { CardProvider } from "@/payments/card";
import { fakeProvider } from "@/payments/fake";
import { buildFakeCardWebhook, fakeCardProvider } from "@/payments/fake-card";
import { codeOf, makeOrg, resetDb, seedSellable, seedStore } from "../helpers";

beforeEach(resetDb);

const NOW = new Date("2026-10-03T12:00:00Z");
const at = (ms: number) => new Date(NOW.getTime() + ms);
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

const down = (over: Partial<CardProvider>): CardProvider => ({ ...fakeCardProvider, ...over });
const payCard = (r: Ready, now = NOW, card: CardProvider = fakeCardProvider) =>
  withOrg(r.orgId, (tx) => startPayment(tx, r.orgId, r.store, r.saleId, fakeProvider, now, { method: "card", card }));
const payPix = (r: Ready, now = NOW, card?: CardProvider) =>
  withOrg(r.orgId, (tx) => startPayment(tx, r.orgId, r.store, r.saleId, fakeProvider, now, { card }));
const cancel = (r: Ready, now = NOW, card: CardProvider = fakeCardProvider, store = r.store) =>
  withOrg(r.orgId, (tx) => cancelPayment(tx, store, r.saleId, now, card));
const rows = (r: Ready) =>
  adminSql`select id, method, status, failure_reason, external_id from payments where sale_id = ${r.saleId} order by created_at, id`;
const saleStatus = async (r: Ready) =>
  (await adminSql`select status from sales where id = ${r.saleId}`)[0].status as string;
const balance = (r: Ready) => withOrg(r.orgId, (tx) => getBalance(tx, r.item.marketProductId));

describe("startPayment with card", () => {
  it("creates a pending card payment for the frozen total, without a QR, valid for two minutes", async () => {
    const r = await ready();
    const view = await payCard(r);
    expect(view.status).toBe("awaiting_payment");
    expect(view.payment).toMatchObject({ method: "card", status: "pending", amountCents: 1000, qrPayload: null });
    expect(view.payment?.expiresAt).toEqual(at(CARD_TTL_MS));
  });

  it("returns the same charge when called again while it is valid", async () => {
    const r = await ready();
    await payCard(r);
    await payCard(r, at(30_000));
    expect(await rows(r)).toHaveLength(1);
  });

  it("issues a new charge after the time ran out and marks the old payment expired", async () => {
    const r = await ready();
    await payCard(r);
    await payCard(r, at(CARD_TTL_MS + 1000));
    const all = await rows(r);
    expect(all.map((p) => [p.status, p.failure_reason])).toEqual([["expired", "expired"], ["pending", null]]);
  });

  it("switching from Pix to card ends the Pix payment as cancelled and keeps one pending", async () => {
    const r = await ready();
    await payPix(r);
    const view = await payCard(r, at(1000));
    expect(view.payment?.method).toBe("card");
    const all = await rows(r);
    expect(all.map((p) => [p.method, p.status, p.failure_reason])).toEqual([
      ["pix", "expired", "cancelled"],
      ["card", "pending", null],
    ]);
  });

  it("switching from card to Pix cancels the charge on the machine", async () => {
    const r = await ready();
    await payCard(r);
    const [card] = await rows(r);
    const view = await payPix(r, at(1000));
    expect(view.payment?.method).toBe("pix");
    expect((await rows(r)).map((p) => [p.method, p.status, p.failure_reason])).toEqual([
      ["card", "expired", "cancelled"],
      ["pix", "pending", null],
    ]);
    expect(await fakeCardProvider.getCharge(card.external_id as string)).toMatchObject({
      status: "failed",
      failureReason: "cancelled",
    });
  });

  it("keeps the card pending and answers provider_unavailable when the machine cannot be told to stop", async () => {
    const r = await ready();
    await payCard(r);
    const broken = down({ cancelCardCharge: async () => { throw new Error("down"); } });
    expect(await codeOf(payPix(r, at(1000), broken))).toBe("provider_unavailable");
    expect((await rows(r)).map((p) => [p.method, p.status])).toEqual([["card", "pending"]]);
    expect(await saleStatus(r)).toBe("awaiting_payment");
  });

  it("answers provider_unavailable when the charge cannot be created, leaving the cart open", async () => {
    const r = await ready();
    const broken = down({ createCardCharge: async () => { throw new Error("down"); } });
    expect(await codeOf(payCard(r, NOW, broken))).toBe("provider_unavailable");
    expect(await rows(r)).toHaveLength(0);
    expect(await saleStatus(r)).toBe("open");
  });

  it("answers provider_unavailable for an unknown card provider in the environment", async () => {
    const r = await ready();
    vi.stubEnv("CARD_PROVIDER", "nope");
    const code = await codeOf(
      withOrg(r.orgId, (tx) => startPayment(tx, r.orgId, r.store, r.saleId, fakeProvider, NOW, { method: "card" })),
    );
    vi.unstubAllEnvs();
    expect(code).toBe("provider_unavailable");
  });

  it("pays the sale once when the approval arrives, whatever the method used first", async () => {
    const r = await ready();
    await payPix(r);
    await payCard(r, at(1000));
    const [, card] = await rows(r);
    await withOrg(r.orgId, (tx) => confirmPayment(tx, card.id as string, 1000, { test: true }, at(2000)));
    expect(await saleStatus(r)).toBe("paid");
    expect(await balance(r)).toBe(-2);
  });
});

describe("cancelPayment", () => {
  it("cancels a card payment: the sale goes back to the cart and the machine stops waiting", async () => {
    const r = await ready();
    await payCard(r);
    const [card] = await rows(r);
    const view = await cancel(r, at(1000));
    expect(view.status).toBe("open");
    expect(view.paymentFailure).toEqual({ method: "card", reason: "cancelled" });
    expect((await rows(r)).map((p) => [p.status, p.failure_reason])).toEqual([["expired", "cancelled"]]);
    expect(await fakeCardProvider.getCharge(card.external_id as string)).toMatchObject({ status: "failed" });
  });

  it("cancels a Pix payment too", async () => {
    const r = await ready();
    await payPix(r);
    expect((await cancel(r, at(1000))).status).toBe("open");
    expect((await rows(r)).map((p) => [p.status, p.failure_reason])).toEqual([["expired", "cancelled"]]);
  });

  it("is idempotent on a sale that is already back at the cart", async () => {
    const r = await ready();
    await payCard(r);
    await cancel(r, at(1000));
    expect((await cancel(r, at(2000))).status).toBe("open");
    expect(await rows(r)).toHaveLength(1);
  });

  it("refuses a sale that is already paid", async () => {
    const r = await ready();
    const view = await payCard(r);
    await withOrg(r.orgId, (tx) => confirmPayment(tx, view.payment!.id, 1000, {}, at(1000)));
    expect(await codeOf(cancel(r, at(2000)))).toBe("sale_not_editable");
  });

  it("keeps the payment pending when the machine cannot be told to stop", async () => {
    const r = await ready();
    await payCard(r);
    const broken = down({ cancelCardCharge: async () => { throw new Error("down"); } });
    expect(await codeOf(cancel(r, at(1000), broken))).toBe("provider_unavailable");
    expect((await rows(r)).map((p) => p.status)).toEqual(["pending"]);
    expect(await saleStatus(r)).toBe("awaiting_payment");
  });

  it("pays the sale instead when the machine had already approved at that instant", async () => {
    const r = await ready();
    await payCard(r);
    const [card] = await rows(r);
    buildFakeCardWebhook(card.external_id as string, { status: "confirmed" });
    const view = await cancel(r, at(1000));
    expect(view.status).toBe("paid");
    expect((await rows(r)).map((p) => p.status)).toEqual(["confirmed"]);
    expect(await balance(r)).toBe(-2);
  });

  it("reopens a sale whose pending payment is already gone", async () => {
    const r = await ready();
    await payCard(r);
    await adminSql`update payments set status = 'failed', failure_reason = 'declined' where sale_id = ${r.saleId}`;
    expect((await cancel(r, at(1000))).status).toBe("open");
  });

  it("does not touch another terminal's sale", async () => {
    const r = await ready();
    await payCard(r);
    const other = await seedStore(r.orgId);
    expect(await codeOf(cancel(r, at(1000), fakeCardProvider, other))).toBe("sale_not_found");
    expect(await saleStatus(r)).toBe("awaiting_payment");
  });
});

describe("failPayment", () => {
  const pending = async (r: Ready) => (await rows(r)).at(-1)!.id as string;
  const fail = (r: Ready, id: string, reason: "declined" | "cancelled" | "expired", now = NOW) =>
    withOrg(r.orgId, (tx) => failPayment(tx, id, reason, now));

  it("marks the payment failed with the reason and puts the sale back at the cart", async () => {
    const r = await ready();
    await payCard(r);
    expect(await fail(r, await pending(r), "declined", at(1000))).toBe(true);
    expect((await rows(r)).map((p) => [p.status, p.failure_reason])).toEqual([["failed", "declined"]]);
    expect(await saleStatus(r)).toBe("open");
  });

  it("marks an expiry as expired rather than failed", async () => {
    const r = await ready();
    await payCard(r);
    await fail(r, await pending(r), "expired", at(1000));
    expect((await rows(r)).map((p) => [p.status, p.failure_reason])).toEqual([["expired", "expired"]]);
  });

  it("is idempotent", async () => {
    const r = await ready();
    await payCard(r);
    const id = await pending(r);
    expect(await fail(r, id, "declined")).toBe(true);
    expect(await fail(r, id, "declined")).toBe(false);
  });

  it("never reverts a confirmed payment", async () => {
    const r = await ready();
    const view = await payCard(r);
    await withOrg(r.orgId, (tx) => confirmPayment(tx, view.payment!.id, 1000, {}, at(1000)));
    expect(await fail(r, view.payment!.id, "declined", at(2000))).toBe(false);
    expect((await rows(r)).map((p) => p.status)).toEqual(["confirmed"]);
    expect(await saleStatus(r)).toBe("paid");
  });

  it("does not reopen a sale that already waits for another payment", async () => {
    const r = await ready();
    await payCard(r);
    const [oldCard] = await rows(r);
    await payPix(r, at(1000));
    expect(await fail(r, oldCard.id as string, "declined", at(2000))).toBe(false);
    expect(await saleStatus(r)).toBe("awaiting_payment");
  });

  it("answers not_found for unknown and malformed payment ids", async () => {
    const r = await ready();
    expect(await codeOf(fail(r, "00000000-0000-0000-0000-000000000000", "declined"))).toBe("not_found");
    expect(await codeOf(fail(r, "nope", "declined"))).toBe("not_found");
  });
});
