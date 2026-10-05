import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adminSql } from "@/db/client";
import { withOrg } from "@/db/tenant";
import { saveMercadoPagoCredentials } from "@/domain/credentials";
import { createTerminal } from "@/domain/terminals";
import { buildFakeCardWebhook } from "@/payments/fake-card";
import { handleCardWebhook } from "@/payments/webhook";
import { cancelPaymentHandler, getSaleHandler, payHandler, scanHandler } from "@/pdv/http";
import { makeOrg, resetDb, seedSellable, seedStore } from "../helpers";

beforeEach(resetDb);
afterEach(() => vi.unstubAllEnvs());

const BARCODE = "7891000100103";

const call = (token: string | undefined, body?: unknown, raw?: string) =>
  new Request("http://m77.test/api/pdv/x", {
    method: "POST",
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
const json = async (res: Response) => (await res.json()) as Record<string, any>;

async function setup() {
  const orgId = await makeOrg("A");
  const store = await seedStore(orgId);
  await seedSellable(orgId, store.marketId, { barcode: BARCODE, priceCents: 500 });
  const { token } = await withOrg(orgId, (tx) =>
    createTerminal(tx, orgId, { marketId: store.marketId, name: "Totem 1" }),
  );
  const sale = await json(await scanHandler(call(token, { barcode: BARCODE })));
  const externalId = async () =>
    (await adminSql`select external_id from payments where sale_id = ${sale.id} order by created_at desc limit 1`)[0]
      .external_id as string;
  const get = async () => json(await getSaleHandler(call(token), sale.id));
  return { orgId, store, token, saleId: sale.id as string, externalId, get };
}
type Setup = Awaited<ReturnType<typeof setup>>;
const payCard = (s: Setup) => payHandler(call(s.token, { method: "card" }), s.saleId);

describe("pay with a method", () => {
  it("starts a card payment: no QR, method card, two minutes to pay", async () => {
    const s = await setup();
    const res = await payCard(s);
    const view = await json(res);
    expect([res.status, view.status]).toEqual([200, "awaiting_payment"]);
    expect(view.payment).toMatchObject({ method: "card", status: "pending", qrPayload: null, amountCents: 500 });
    expect(typeof view.payment.expiresAt).toBe("string");
  });

  it("keeps Pix as the default for an empty body, an empty object and an explicit pix", async () => {
    for (const body of [undefined, {}, { method: "pix" }]) {
      const s = await setup();
      const view = await json(await payHandler(call(s.token, body), s.saleId));
      expect(view.payment.method).toBe("pix");
      expect(view.payment.qrPayload).toMatch(/^FAKEPIX\|/);
    }
  });

  it("answers 400 to an unknown method, a bad body type and broken JSON, never 500", async () => {
    const s = await setup();
    for (const [body, raw] of [[{ method: "boleto" }], [{ method: 1 }], [undefined, "null"], [undefined, "{"]] as const) {
      const res = await payHandler(call(s.token, body, raw), s.saleId);
      expect([res.status, (await json(res)).error]).toEqual([400, "invalid_input"]);
    }
  });

  it("answers 503 provider_unavailable when the card charge cannot be created", async () => {
    const s = await setup();
    vi.stubEnv("FAKE_CARD_SECRET", "");
    const res = await payCard(s);
    expect([res.status, (await json(res)).error]).toEqual([503, "provider_unavailable"]);
    vi.unstubAllEnvs();
    expect((await s.get()).status).toBe("open");
  });

  it("answers 503 when no card provider can be resolved", async () => {
    const s = await setup();
    await withOrg(s.orgId, (tx) =>
      saveMercadoPagoCredentials(tx, s.orgId, { accessToken: "APP_USR-token-1234", webhookSecret: "whsec-123456" }),
    );
    vi.stubEnv("CREDENTIALS_KEY", ""); // credentials that cannot be decrypted: no provider can be resolved
    const res = await payCard(s);
    expect([res.status, (await json(res)).error]).toEqual([503, "provider_unavailable"]);
  });
});

describe("card outcomes seen by the totem", () => {
  it("shows the sale paid after the machine approves", async () => {
    const s = await setup();
    await payCard(s);
    const { headers, rawBody } = buildFakeCardWebhook(await s.externalId(), { status: "confirmed" });
    expect((await handleCardWebhook("fake", headers, rawBody)).body.result).toBe("confirmed");
    expect((await s.get()).status).toBe("paid");
  });

  it("shows the cart again, with the reason, after a decline, and lets the customer pay with Pix", async () => {
    const s = await setup();
    await payCard(s);
    const { headers, rawBody } = buildFakeCardWebhook(await s.externalId(), { status: "failed", failureReason: "declined" });
    await handleCardWebhook("fake", headers, rawBody);
    const view = await s.get();
    expect(view.status).toBe("open");
    expect(view.paymentFailure).toEqual({ method: "card", reason: "declined" });
    expect(view.payment.failureReason).toBe("declined");
    const pix = await json(await payHandler(call(s.token), s.saleId));
    expect([pix.status, pix.payment.method, pix.paymentFailure]).toEqual(["awaiting_payment", "pix", null]);
  });
});

describe("cancel payment", () => {
  it("puts the sale back at the cart, keeps the items, and is idempotent", async () => {
    const s = await setup();
    await payCard(s);
    const res = await cancelPaymentHandler(call(s.token), s.saleId);
    const view = await json(res);
    expect([res.status, view.status, view.items.length]).toEqual([200, "open", 1]);
    expect(view.paymentFailure).toEqual({ method: "card", reason: "cancelled" });
    const again = await cancelPaymentHandler(call(s.token), s.saleId);
    expect([again.status, (await json(again)).status]).toEqual([200, "open"]);
    const next = await json(await payCard(s));
    expect(next.status).toBe("awaiting_payment");
  });

  it("answers 409 for a paid sale", async () => {
    const s = await setup();
    await payCard(s);
    const { headers, rawBody } = buildFakeCardWebhook(await s.externalId(), { status: "confirmed" });
    await handleCardWebhook("fake", headers, rawBody);
    const res = await cancelPaymentHandler(call(s.token), s.saleId);
    expect([res.status, (await json(res)).error]).toEqual([409, "sale_not_editable"]);
  });

  it("keeps the payment pending and answers 503 when the machine cannot be told to stop", async () => {
    const s = await setup();
    await payCard(s);
    vi.stubEnv("FAKE_CARD_SECRET", "");
    const res = await cancelPaymentHandler(call(s.token), s.saleId);
    expect([res.status, (await json(res)).error]).toEqual([503, "provider_unavailable"]);
    vi.unstubAllEnvs();
    expect((await s.get()).status).toBe("awaiting_payment");
  });

  it("answers 401 without a token, and 404 for malformed ids and for another terminal or organization", async () => {
    const s = await setup();
    await payCard(s);
    expect((await cancelPaymentHandler(call(undefined), s.saleId)).status).toBe(401);
    expect((await cancelPaymentHandler(call(s.token), "nope")).status).toBe(404);
    const second = await withOrg(s.orgId, (tx) =>
      createTerminal(tx, s.orgId, { marketId: s.store.marketId, name: "Totem 2" }),
    );
    expect((await cancelPaymentHandler(call(second.token), s.saleId)).status).toBe(404);
    const other = await setup();
    expect((await cancelPaymentHandler(call(other.token), s.saleId)).status).toBe(404);
    expect((await s.get()).status).toBe("awaiting_payment");
  });
});
