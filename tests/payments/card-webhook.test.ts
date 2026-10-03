import { beforeEach, describe, expect, it } from "vitest";
import { adminSql } from "@/db/client";
import { withOrg } from "@/db/tenant";
import { startPayment } from "@/domain/payments";
import { addItemByBarcode } from "@/domain/sales";
import { buildFakeWebhook, fakeProvider } from "@/payments/fake";
import { buildFakeCardWebhook, fakeCardProvider } from "@/payments/fake-card";
import { handleCardWebhook, handleProviderWebhook } from "@/payments/webhook";
import { makeOrg, resetDb, seedSellable, seedStore } from "../helpers";

beforeEach(resetDb);

const NOW = new Date("2026-10-03T12:00:00Z");
const BARCODE = "7891000100103";

async function awaitingCard() {
  const orgId = await makeOrg("A");
  const store = await seedStore(orgId);
  await seedSellable(orgId, store.marketId, { barcode: BARCODE, priceCents: 500 });
  const sale = await withOrg(orgId, (tx) => addItemByBarcode(tx, orgId, store, { barcode: BARCODE }, NOW));
  const start = (method: "card" | "pix", now = NOW) =>
    withOrg(orgId, (tx) =>
      startPayment(tx, orgId, store, sale.id, fakeProvider, now, { method, card: fakeCardProvider }),
    );
  await start("card");
  const [p] = await adminSql`select external_id from payments where sale_id = ${sale.id}`;
  return { orgId, saleId: sale.id, externalId: p.external_id as string, start };
}
const movements = async (saleId: string) =>
  (await adminSql`select count(*)::int as n from stock_movements where sale_id = ${saleId}`)[0].n as number;
const sale = async (saleId: string) =>
  (await adminSql`select status from sales where id = ${saleId}`)[0].status as string;
const payments = (saleId: string) =>
  adminSql`select method, status, failure_reason from payments where sale_id = ${saleId} order by created_at, id`;
const hook = (r: { headers: Headers; rawBody: string }) => handleCardWebhook("fake", r.headers, r.rawBody, NOW);

describe("handleCardWebhook", () => {
  it("confirms an approval, pays the sale and takes stock out once", async () => {
    const { saleId, externalId } = await awaitingCard();
    const r = buildFakeCardWebhook(externalId, { status: "confirmed" });
    expect(await hook(r)).toEqual({ status: 200, body: { result: "confirmed" } });
    expect((await hook(r)).body.result).toBe("already_confirmed");
    expect(await sale(saleId)).toBe("paid");
    expect(await movements(saleId)).toBe(1);
  });

  it("puts the sale back at the cart when the card is declined, and ignores a repeat", async () => {
    const { saleId, externalId } = await awaitingCard();
    const r = buildFakeCardWebhook(externalId, { status: "failed", failureReason: "declined" });
    expect(await hook(r)).toEqual({ status: 200, body: { result: "failed" } });
    expect((await hook(r)).body.result).toBe("ignored");
    expect(await sale(saleId)).toBe("open");
    expect((await payments(saleId)).map((p) => [p.status, p.failure_reason])).toEqual([["failed", "declined"]]);
    expect(await movements(saleId)).toBe(0);
  });

  it("treats a failure without a reason as declined and an expiry as expired", async () => {
    const a = await awaitingCard();
    await hook(buildFakeCardWebhook(a.externalId, { status: "failed" }));
    expect((await payments(a.saleId)).map((p) => [p.status, p.failure_reason])).toEqual([["failed", "declined"]]);
    const b = await awaitingCard();
    await hook(buildFakeCardWebhook(b.externalId, { status: "expired" }));
    expect((await payments(b.saleId)).map((p) => [p.status, p.failure_reason])).toEqual([["expired", "expired"]]);
  });

  it("never reverts a confirmed payment when a decline arrives afterwards", async () => {
    const { saleId, externalId } = await awaitingCard();
    await hook(buildFakeCardWebhook(externalId, { status: "confirmed" }));
    const late = await hook(buildFakeCardWebhook(externalId, { status: "failed", failureReason: "declined" }));
    expect(late.body.result).toBe("ignored");
    expect(await sale(saleId)).toBe("paid");
    expect((await payments(saleId)).map((p) => p.status)).toEqual(["confirmed"]);
  });

  it("does not reopen a sale that already waits for another payment", async () => {
    const { saleId, externalId, start } = await awaitingCard();
    await start("pix", new Date(NOW.getTime() + 1000));
    const r = await hook(buildFakeCardWebhook(externalId, { status: "failed", failureReason: "declined" }));
    expect(r.body.result).toBe("ignored");
    expect(await sale(saleId)).toBe("awaiting_payment");
  });

  it("rejects an approval for the wrong amount, like the Pix path", async () => {
    const { externalId } = await awaitingCard();
    const r = await hook(buildFakeCardWebhook(externalId, { status: "confirmed", amountCents: 1 }));
    expect(r.body.result).toBe("rejected");
  });

  it("answers 401 to a bad signature or a body that is not JSON, 404 to unknown providers", async () => {
    const { externalId } = await awaitingCard();
    const { rawBody } = buildFakeCardWebhook(externalId, { status: "confirmed" });
    const bad = await handleCardWebhook("fake", new Headers({ "x-fake-signature": "00" }), rawBody, NOW);
    expect([bad.status, bad.body.result]).toEqual([401, "invalid_webhook"]);
    expect((await handleCardWebhook("fake", new Headers({ "x-fake-signature": "00" }), "not json", NOW)).status).toBe(401);
    for (const name of ["nope", "constructor", "__proto__"]) {
      const r = await handleCardWebhook(name, new Headers(), "{}", NOW);
      expect([r.status, r.body.result]).toEqual([404, "unknown_provider"]);
    }
  });

  it("answers 200 and ignores an unknown payment", async () => {
    await awaitingCard();
    const r = await hook(buildFakeCardWebhook("fakecard_unknown", { status: "confirmed" }));
    expect(r).toEqual({ status: 200, body: { result: "unknown_payment" } });
  });

  it("keeps the Pix and card paths apart: neither handler finds the other's payments", async () => {
    const { externalId } = await awaitingCard();
    const asPix = buildFakeWebhook(externalId);
    expect((await handleProviderWebhook("fake", asPix.headers, asPix.rawBody, NOW)).body.result).toBe("unknown_payment");
  });
});
