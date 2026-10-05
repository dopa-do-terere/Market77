import { describe, expect, it } from "vitest";
import { MercadoPagoError } from "@/payments/mercadopago-http";
import { mercadoPagoPix } from "@/payments/mercadopago-pix";
import { fakeFetch } from "./mp-fetch";

const CREDS = { accessToken: "APP_USR-token-1234", webhookSecret: "whsec-123456" };
const NOW = new Date("2026-10-05T12:00:00Z");
const clock = () => NOW;
const expiresAt = new Date("2026-10-05T12:03:00Z");

describe("mercadoPagoPix", () => {
  it("creates a Pix payment and returns the copy-and-paste code", async () => {
    const { f, calls } = fakeFetch(() => ({
      status: 201,
      json: { id: 987654, status: "pending", point_of_interaction: { transaction_data: { qr_code: "000201PIX" } } },
    }));
    const c = await mercadoPagoPix(CREDS, f, clock).createPixCharge({ saleId: "sale-1", amountCents: 1250, expiresAt });
    expect(c).toEqual({ externalId: "987654", qrPayload: "000201PIX", expiresAt });
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toBe("https://api.mercadopago.com/v1/payments");
    expect(calls[0].headers["X-Idempotency-Key"]).toBe(`sale-1:${expiresAt.getTime()}`);
    const body = calls[0].body as Record<string, unknown>;
    expect(body.transaction_amount).toBe(12.5);
    expect(body.payment_method_id).toBe("pix");
    expect(body.external_reference).toBe("sale-1");
    expect((body.payer as { email: string }).email).toMatch(/@/);
  });

  it("asks Mercado Pago for at least 31 minutes, because it refuses a shorter Pix", async () => {
    const { f, calls } = fakeFetch(() => ({
      json: { id: 1, point_of_interaction: { transaction_data: { qr_code: "x" } } },
    }));
    await mercadoPagoPix(CREDS, f, clock).createPixCharge({ saleId: "s", amountCents: 100, expiresAt });
    const sent = new Date((calls[0].body as { date_of_expiration: string }).date_of_expiration);
    expect(sent.getTime() - NOW.getTime()).toBeGreaterThanOrEqual(31 * 60_000);
  });

  it("fails when the answer has no QR code", async () => {
    const { f } = fakeFetch(() => ({ json: { id: 1 } }));
    await expect(
      mercadoPagoPix(CREDS, f, clock).createPixCharge({ saleId: "s", amountCents: 100, expiresAt }),
    ).rejects.toThrow();
  });

  it.each([
    ["approved", undefined, "confirmed"],
    ["pending", "pending_waiting_transfer", "pending"],
    ["in_process", undefined, "pending"],
    ["authorized", undefined, "pending"],
    ["rejected", undefined, "failed"],
    ["cancelled", "by_collector", "failed"],
    ["cancelled", "expired", "expired"],
    ["refunded", undefined, "failed"],
    ["charged_back", undefined, "failed"],
  ])("maps %s (%s) to %s and converts the amount to cents", async (status, detail, expected) => {
    const { f, calls } = fakeFetch(() => ({
      json: { id: 55, status, status_detail: detail, transaction_amount: 12.35 },
    }));
    const r = await mercadoPagoPix(CREDS, f, clock).getCharge("55");
    expect(r).toEqual({ status: expected, amountCents: 1235 });
    expect(calls[0].method).toBe("GET");
    expect(calls[0].url).toBe("https://api.mercadopago.com/v1/payments/55");
  });

  it("treats an unknown status as an error, not as a state", async () => {
    const { f } = fakeFetch(() => ({ json: { status: "algo_novo", transaction_amount: 1 } }));
    await expect(mercadoPagoPix(CREDS, f, clock).getCharge("1")).rejects.toThrow();
  });

  it("does not leak the response body when Mercado Pago fails", async () => {
    const { f } = fakeFetch(() => ({ status: 500, json: { payer: { email: "ana@example.com" } } }));
    const err = await mercadoPagoPix(CREDS, f, clock).getCharge("1").catch((e) => e);
    expect(err).toBeInstanceOf(MercadoPagoError);
    expect(String(err.message)).not.toContain("ana@example.com");
  });

  it("is not reachable through the generic webhook parser", () => {
    expect(() => mercadoPagoPix(CREDS, fakeFetch(() => ({})).f).parseWebhook(new Headers(), "{}")).toThrow(
      /handleMercadoPagoWebhook/,
    );
  });
});
