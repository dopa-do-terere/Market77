import { describe, expect, it } from "vitest";
import { MercadoPagoError, mpCall, verifyNotification } from "@/payments/mercadopago-http";
import { fakeFetch, signNotification } from "./mp-fetch";

const CREDS = { accessToken: "APP_USR-token-1234", webhookSecret: "whsec-123456" };
const NOW = new Date("2026-10-05T12:00:00Z");
const ts = (d: Date) => Math.floor(d.getTime() / 1000);
const url = (id: string) => new URL(`https://app.example/api/webhooks/pix/mercadopago/org?data.id=${id}&type=payment`);
const body = (type: string, id: string) => JSON.stringify({ type, action: `${type}.updated`, data: { id } });

describe("mpCall", () => {
  it("sends the bearer token and the idempotency key", async () => {
    const { f, calls } = fakeFetch(() => ({ json: { ok: true } }));
    await mpCall(CREDS, f, "POST", "/v1/payments", { body: { a: 1 }, idempotencyKey: "k1" });
    expect(calls[0].url).toBe("https://api.mercadopago.com/v1/payments");
    expect(calls[0].headers.Authorization).toBe("Bearer APP_USR-token-1234");
    expect(calls[0].headers["X-Idempotency-Key"]).toBe("k1");
    expect(calls[0].body).toEqual({ a: 1 });
  });

  it("throws an error that carries the status and nothing of the response", async () => {
    const { f } = fakeFetch(() => ({ status: 401, json: { message: "payer ana@example.com" } }));
    const err = (await mpCall(CREDS, f, "GET", "/x").catch((e) => e)) as MercadoPagoError;
    expect(err).toBeInstanceOf(MercadoPagoError);
    expect(err.status).toBe(401);
    expect(String(err.message)).not.toContain("ana@example.com");
    expect(JSON.stringify(err)).not.toContain("ana@example.com");
  });
});

describe("verifyNotification", () => {
  const secret = CREDS.webhookSecret;
  const ok = (id = "123456", type = "payment", at = NOW) =>
    verifyNotification(secret, signNotification(secret, { id, ts: ts(at) }), body(type, id), url(id), NOW);

  it("accepts a genuine payment and a genuine order notification", () => {
    expect(ok()).toEqual({ kind: "payment", id: "123456" });
    expect(ok("ORD01ABC", "order")).toEqual({ kind: "order", id: "ORD01ABC" });
  });

  it("accepts a millisecond timestamp", () => {
    const h = signNotification(secret, { id: "1", ts: NOW.getTime() });
    expect(verifyNotification(secret, h, body("payment", "1"), url("1"), NOW)).toEqual({ kind: "payment", id: "1" });
  });

  it("returns null for another topic after checking the signature", () => {
    expect(ok("1", "merchant_order")).toBeNull();
  });

  it("rejects a wrong secret, a changed id, a missing header and garbage", () => {
    const h = signNotification(secret, { id: "123456", ts: ts(NOW), secretOverride: "outro-segredo" });
    expect(() => verifyNotification(secret, h, body("payment", "123456"), url("123456"), NOW)).toThrow();
    const good = signNotification(secret, { id: "123456", ts: ts(NOW) });
    expect(() => verifyNotification(secret, good, body("payment", "999"), url("999"), NOW)).toThrow();
    expect(() => verifyNotification(secret, new Headers(), body("payment", "1"), url("1"), NOW)).toThrow();
    expect(() => verifyNotification(secret, good, "nao e json", url("1"), NOW)).toThrow();
    const hex = new Headers({ "x-signature": `ts=${ts(NOW)},v1=zz`, "x-request-id": "req-1" });
    expect(() => verifyNotification(secret, hex, body("payment", "1"), url("1"), NOW)).toThrow();
  });

  it("rejects an old or future timestamp", () => {
    expect(() => ok("1", "payment", new Date(NOW.getTime() - 6 * 60_000))).toThrow();
    expect(() => ok("1", "payment", new Date(NOW.getTime() + 6 * 60_000))).toThrow();
  });

  it("falls back to the id in the body when the query has none", () => {
    const h = signNotification(secret, { id: "777", ts: ts(NOW) });
    expect(
      verifyNotification(secret, h, body("payment", "777"), new URL("https://app.example/x"), NOW),
    ).toEqual({ kind: "payment", id: "777" });
  });
});
