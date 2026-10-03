import { beforeEach, describe, expect, it } from "vitest";
import { adminSql } from "@/db/client";
import { withOrg } from "@/db/tenant";
import { startPayment } from "@/domain/payments";
import { addItemByBarcode } from "@/domain/sales";
import { buildFakeWebhook, fakeProvider } from "@/payments/fake";
import { handleProviderWebhook } from "@/payments/webhook";
import { makeOrg, resetDb, seedSellable, seedStore } from "../helpers";

beforeEach(resetDb);

const NOW = new Date("2026-10-02T12:00:00Z");
const BARCODE = "7891000100103";

async function awaiting() {
  const orgId = await makeOrg("A");
  const store = await seedStore(orgId);
  await seedSellable(orgId, store.marketId, { barcode: BARCODE, priceCents: 500 });
  const sale = await withOrg(orgId, (tx) => addItemByBarcode(tx, orgId, store, { barcode: BARCODE }, NOW));
  const view = await withOrg(orgId, (tx) => startPayment(tx, orgId, store, sale.id, fakeProvider, NOW));
  return { saleId: sale.id, externalId: view.payment!.qrPayload.split("|")[1] };
}
const movements = async (saleId: string) =>
  (await adminSql`select count(*)::int as n from stock_movements where sale_id = ${saleId}`)[0].n as number;
const status = async (saleId: string) =>
  (await adminSql`select status from sales where id = ${saleId}`)[0].status as string;

describe("handleProviderWebhook", () => {
  it("confirms a genuine webhook and pays the sale", async () => {
    const { saleId, externalId } = await awaiting();
    const { headers, rawBody } = buildFakeWebhook(externalId);
    expect(await handleProviderWebhook("fake", headers, rawBody, NOW)).toEqual({ status: 200, body: { result: "confirmed" } });
    expect(await status(saleId)).toBe("paid");
    expect(await movements(saleId)).toBe(1);
  });

  it("answers 401 to a bad signature and changes nothing", async () => {
    const { saleId, externalId } = await awaiting();
    const { rawBody } = buildFakeWebhook(externalId);
    const r = await handleProviderWebhook("fake", new Headers({ "x-fake-signature": "00" }), rawBody, NOW);
    expect([r.status, r.body.result]).toEqual([401, "invalid_webhook"]);
    expect(await status(saleId)).toBe("awaiting_payment");
  });

  it("answers 401 to a body that is not even JSON", async () => {
    await awaiting();
    const r = await handleProviderWebhook("fake", new Headers({ "x-fake-signature": "00" }), "not json", NOW);
    expect(r.status).toBe(401);
  });

  it.each(["nope", "constructor", "__proto__"])("answers 404 to the unknown provider %s", async (name) => {
    const r = await handleProviderWebhook(name, new Headers(), "{}", NOW);
    expect([r.status, r.body.result]).toEqual([404, "unknown_provider"]);
  });

  it("answers 200 and ignores an unknown payment", async () => {
    await awaiting();
    const { headers, rawBody } = buildFakeWebhook("fake_unknown");
    expect(await handleProviderWebhook("fake", headers, rawBody, NOW)).toEqual({ status: 200, body: { result: "unknown_payment" } });
  });

  it("confirms once when the same webhook is delivered again", async () => {
    const { saleId, externalId } = await awaiting();
    const { headers, rawBody } = buildFakeWebhook(externalId);
    await handleProviderWebhook("fake", headers, rawBody, NOW);
    expect((await handleProviderWebhook("fake", headers, rawBody, NOW)).body.result).toBe("already_confirmed");
    expect(await movements(saleId)).toBe(1);
  });

  it("confirms once when ten deliveries race", async () => {
    const { saleId, externalId } = await awaiting();
    const { headers, rawBody } = buildFakeWebhook(externalId);
    const results = await Promise.all(Array.from({ length: 10 }, () => handleProviderWebhook("fake", headers, rawBody, NOW)));
    expect(results.filter((r) => r.body.result === "confirmed")).toHaveLength(1);
    expect(await movements(saleId)).toBe(1);
  });

  it("does not pay the sale when the amount differs", async () => {
    const { saleId, externalId } = await awaiting();
    const { headers, rawBody } = buildFakeWebhook(externalId, { amountCents: 499 });
    expect((await handleProviderWebhook("fake", headers, rawBody, NOW)).body.result).toBe("rejected");
    expect(await status(saleId)).toBe("awaiting_payment");
    expect(await movements(saleId)).toBe(0);
  });

  it("ignores expired and failed events (reconciliation reads the provider instead)", async () => {
    const { saleId, externalId } = await awaiting();
    const { headers, rawBody } = buildFakeWebhook(externalId, { status: "failed" });
    expect((await handleProviderWebhook("fake", headers, rawBody, NOW)).body.result).toBe("ignored");
    expect(await status(saleId)).toBe("awaiting_payment");
  });
});
