import { beforeEach, describe, expect, it } from "vitest";
import { adminSql } from "@/db/client";
import { withOrg } from "@/db/tenant";
import { saveMercadoPagoCredentials } from "@/domain/credentials";
import { startPayment } from "@/domain/payments";
import { addItemByBarcode } from "@/domain/sales";
import { fakeProvider } from "@/payments/fake";
import { fakeCardProvider } from "@/payments/fake-card";
import { handleMercadoPagoWebhook } from "@/payments/webhook";
import { makeOrg, resetDb, seedSellable, seedStore } from "../helpers";
import { fakeFetch, signNotification } from "./mp-fetch";

beforeEach(resetDb);

const NOW = new Date("2026-10-05T12:00:00Z");
const BARCODE = "7891000100103";
const SECRET = "whsec-123456";
const CREDS = { accessToken: "APP_USR-token-1234", webhookSecret: SECRET };
const ts = Math.floor(NOW.getTime() / 1000);

/** A sale awaiting payment whose payment now belongs to Mercado Pago under the given external id. */
async function awaiting(method: "pix" | "card", externalId: string, name = "A") {
  const orgId = await makeOrg(name);
  const store = await seedStore(orgId);
  await seedSellable(orgId, store.marketId, { barcode: BARCODE, priceCents: 500 });
  await withOrg(orgId, (tx) => saveMercadoPagoCredentials(tx, orgId, CREDS));
  const sale = await withOrg(orgId, (tx) => addItemByBarcode(tx, orgId, store, { barcode: BARCODE }, NOW));
  await withOrg(orgId, (tx) =>
    startPayment(tx, orgId, store, sale.id, fakeProvider, NOW, { method, card: fakeCardProvider }),
  );
  await adminSql`update payments set provider = 'mercadopago', external_id = ${externalId} where sale_id = ${sale.id}`;
  return { orgId, saleId: sale.id };
}

const payment = (status: string, amount = 5, detail?: string) => ({
  json: { status, status_detail: detail, transaction_amount: amount },
});
const order = (status: string, amount = "5.00") => ({ json: { status, total_amount: amount } });

const deliver = (
  kind: "pix" | "card",
  orgId: string,
  id: string,
  reply: { status?: number; json?: unknown },
  o: { secret?: string; ts?: number; type?: string; sigId?: string } = {},
) => {
  const { f } = fakeFetch(() => reply);
  const type = o.type ?? (kind === "pix" ? "payment" : "order");
  const rawBody = JSON.stringify({ type, action: `${type}.updated`, data: { id }, lie: { amount: 99999 } });
  const url = new URL(`https://app.example/api/webhooks/${kind}/mercadopago/${orgId}?data.id=${id}&type=${type}`);
  const headers = signNotification(SECRET, { id: o.sigId ?? id, ts: o.ts ?? ts, secretOverride: o.secret });
  return handleMercadoPagoWebhook(kind, orgId, url, headers, rawBody, NOW, f);
};

const saleStatus = async (saleId: string) =>
  (await adminSql`select status from sales where id = ${saleId}`)[0].status as string;
const movements = async (saleId: string) =>
  (await adminSql`select count(*)::int as n from stock_movements where sale_id = ${saleId}`)[0].n as number;

describe("handleMercadoPagoWebhook", () => {
  it("confirms an approved Pix, pays the sale and takes stock out once", async () => {
    const { orgId, saleId } = await awaiting("pix", "9001");
    expect(await deliver("pix", orgId, "9001", payment("approved"))).toEqual({
      status: 200,
      body: { result: "confirmed" },
    });
    expect((await deliver("pix", orgId, "9001", payment("approved"))).body.result).toBe("already_confirmed");
    expect(await saleStatus(saleId)).toBe("paid");
    expect(await movements(saleId)).toBe(1);
  });

  it("takes state and amount from the API, never from the webhook body", async () => {
    const { orgId, saleId } = await awaiting("pix", "9002");
    const r = await deliver("pix", orgId, "9002", payment("approved", 1)); // body lies 99999, API says 1.00 paid
    expect(r.body.result).toBe("rejected");
    expect(await saleStatus(saleId)).not.toBe("paid");
    expect(await movements(saleId)).toBe(0);
  });

  it("confirms an approved card order", async () => {
    const { orgId, saleId } = await awaiting("card", "ORD9003");
    expect((await deliver("card", orgId, "ORD9003", order("processed"))).body.result).toBe("confirmed");
    expect(await saleStatus(saleId)).toBe("paid");
  });

  it("puts the sale back at the cart when the card is declined, and ignores a repeat", async () => {
    const { orgId, saleId } = await awaiting("card", "ORD9004");
    expect(await deliver("card", orgId, "ORD9004", order("failed"))).toEqual({
      status: 200,
      body: { result: "failed" },
    });
    expect(await saleStatus(saleId)).toBe("open");
    expect((await deliver("card", orgId, "ORD9004", order("failed"))).body.result).toBe("ignored");
    const [p] = await adminSql`select status, failure_reason from payments where sale_id = ${saleId}`;
    expect(p).toMatchObject({ status: "failed", failure_reason: "declined" });
  });

  it("maps an expired or cancelled card order to the matching reason", async () => {
    const a = await awaiting("card", "ORD9005");
    await deliver("card", a.orgId, "ORD9005", order("expired"));
    expect((await adminSql`select failure_reason from payments where sale_id = ${a.saleId}`)[0].failure_reason).toBe("expired");
    const b = await awaiting("card", "ORD9006", "B");
    await deliver("card", b.orgId, "ORD9006", order("canceled"));
    expect((await adminSql`select failure_reason from payments where sale_id = ${b.saleId}`)[0].failure_reason).toBe("cancelled");
  });

  it("ignores a Pix that is still pending or failed (the reconciliation reads the same state)", async () => {
    const { orgId, saleId } = await awaiting("pix", "9007");
    expect((await deliver("pix", orgId, "9007", payment("pending"))).body.result).toBe("ignored");
    expect((await deliver("pix", orgId, "9007", payment("rejected"))).body.result).toBe("ignored");
    expect(await saleStatus(saleId)).toBe("awaiting_payment");
  });

  it("a late approval is rejected when the sale total changed meanwhile", async () => {
    const { orgId, saleId } = await awaiting("pix", "9008");
    await adminSql`update sales set total_cents = 700 where id = ${saleId}`;
    expect((await deliver("pix", orgId, "9008", payment("approved"))).body.result).toBe("rejected");
    expect(await saleStatus(saleId)).not.toBe("paid");
  });

  it("answers 404 for an unknown organization, a malformed id or an organization without credentials", async () => {
    const { orgId } = await awaiting("pix", "9009");
    const empty = await makeOrg("Sem credenciais");
    expect((await deliver("pix", "00000000-0000-4000-8000-000000000000", "9009", payment("approved"))).status).toBe(404);
    expect((await deliver("pix", "nao-e-uuid", "9009", payment("approved"))).status).toBe(404);
    expect((await deliver("pix", empty, "9009", payment("approved"))).status).toBe(404);
    expect(orgId).toBeTruthy();
  });

  it("answers 401 for a wrong secret, a stale timestamp or a signature over another id", async () => {
    const { orgId, saleId } = await awaiting("pix", "9010");
    for (const o of [{ secret: "outro-segredo" }, { ts: ts - 3600 }, { sigId: "1234" }]) {
      expect(await deliver("pix", orgId, "9010", payment("approved"), o)).toEqual({
        status: 401,
        body: { result: "invalid_webhook" },
      });
    }
    expect(await saleStatus(saleId)).toBe("awaiting_payment");
  });

  it("never lets the secret of one organization confirm a payment of another", async () => {
    const a = await awaiting("pix", "9011", "A");
    const b = await awaiting("pix", "9111", "B"); // a payment id is unique per provider, so B has its own
    await withOrg(b.orgId, (tx) =>
      saveMercadoPagoCredentials(tx, b.orgId, { accessToken: "APP_USR-token-b-1234", webhookSecret: "segredo-da-org-b" }),
    );
    // Org B's URL signed with org A's secret
    expect((await deliver("pix", b.orgId, "9111", payment("approved"))).status).toBe(401);
    // Org A's URL cannot reach org B's payment id
    expect((await deliver("pix", a.orgId, "9111", payment("approved"))).body.result).toBe("unknown_payment");
    expect((await deliver("pix", a.orgId, "9011", payment("approved"))).body.result).toBe("confirmed");
    expect(await saleStatus(a.saleId)).toBe("paid");
    expect(await saleStatus(b.saleId)).toBe("awaiting_payment");
  });

  it("answers unknown_payment for an id nobody owns and ignores other topics", async () => {
    const { orgId } = await awaiting("pix", "9012");
    expect((await deliver("pix", orgId, "424242", payment("approved"))).body.result).toBe("unknown_payment");
    expect((await deliver("pix", orgId, "9012", payment("approved"), { type: "merchant_order" })).body.result).toBe("ignored");
    // a card notification on the Pix route is not a Pix event
    expect((await deliver("pix", orgId, "9012", payment("approved"), { type: "order" })).body.result).toBe("ignored");
  });

  it("answers 503 so Mercado Pago retries when the API cannot be asked", async () => {
    const { orgId, saleId } = await awaiting("pix", "9013");
    expect(await deliver("pix", orgId, "9013", { status: 500, json: {} })).toEqual({
      status: 503,
      body: { result: "provider_unavailable" },
    });
    expect(await saleStatus(saleId)).toBe("awaiting_payment");
  });

  it("answers 404 when the stored credentials cannot be decrypted", async () => {
    const { orgId } = await awaiting("pix", "9014");
    await adminSql`update provider_credentials set webhook_secret_enc = 'v1:AAAA:AAAA:AAAA'`;
    expect((await deliver("pix", orgId, "9014", payment("approved"))).status).toBe(404);
  });
  it("answers 401, never 500, for a body that is the JSON literal null", async () => {
    const { orgId } = await awaiting("pix", "9015");
    const { f } = fakeFetch(() => payment("approved"));
    const url = new URL(`https://app.example/api/webhooks/pix/mercadopago/${orgId}?data.id=9015&type=payment`);
    const r = await handleMercadoPagoWebhook("pix", orgId, url, signNotification(SECRET, { id: "9015", ts }), "null", NOW, f);
    expect([200, 401]).toContain(r.status);
    expect(r.body.result).not.toBe("confirmed");
  });
});
