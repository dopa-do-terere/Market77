import { describe, expect, it } from "vitest";
import { mercadoPagoPoint } from "@/payments/mercadopago-card";
import { type Call, fakeFetch } from "./mp-fetch";

const CREDS = { accessToken: "APP_USR-token-1234", webhookSecret: "whsec-123456" };
const NOW = new Date("2026-10-05T12:00:00Z");
const clock = () => NOW;
const expiresAt = new Date("2026-10-05T12:02:00Z");
const device = async () => "NEWLAND_N950__X1";
const args = { saleId: "sale-1", amountCents: 2400, terminalId: "totem-1", expiresAt };

const order = (status: string, extra: Record<string, unknown> = {}) => ({
  id: "ORD01",
  status,
  total_amount: "24.00",
  ...extra,
});

describe("mercadoPagoPoint", () => {
  it("creates a Point order for the paired machine", async () => {
    const { f, calls } = fakeFetch(() => ({ status: 201, json: order("created") }));
    const c = await mercadoPagoPoint(CREDS, device, f, clock).createCardCharge(args);
    expect(c).toEqual({ externalId: "ORD01", expiresAt });
    expect(calls[0].url).toBe("https://api.mercadopago.com/v1/orders");
    expect(calls[0].headers["X-Idempotency-Key"]).toBe(`sale-1:${expiresAt.getTime()}`);
    expect(calls[0].body).toEqual({
      type: "point",
      external_reference: "sale-1",
      expiration_time: "PT2M",
      transactions: { payments: [{ amount: "24.00" }] },
      config: { point: { terminal_id: "NEWLAND_N950__X1", print_on_terminal: "no_ticket" } },
      description: "Compra no totem",
    });
  });

  it("never fixes debit or credit: the customer picks on the machine", async () => {
    const { f, calls } = fakeFetch(() => ({ json: order("created") }));
    await mercadoPagoPoint(CREDS, device, f, clock).createCardCharge(args);
    expect(JSON.stringify(calls[0].body)).not.toContain("default_type");
  });

  it("fails without calling Mercado Pago when the totem has no machine", async () => {
    const { f, calls } = fakeFetch(() => ({ json: order("created") }));
    await expect(mercadoPagoPoint(CREDS, async () => null, f, clock).createCardCharge(args)).rejects.toThrow(
      /no Point/,
    );
    expect(calls).toHaveLength(0);
  });

  it.each([
    ["created", {}, "pending", undefined],
    ["at_terminal", {}, "pending", undefined],
    ["action_required", {}, "pending", undefined],
    ["processed", {}, "confirmed", undefined],
    ["canceled", {}, "failed", "cancelled"],
    ["failed", {}, "failed", "declined"],
    ["refunded", {}, "failed", "cancelled"],
    ["expired", {}, "expired", undefined],
  ])("maps order status %s to %s", async (status, extra, expected, reason) => {
    const { f, calls } = fakeFetch(() => ({ json: order(status, extra) }));
    const r = await mercadoPagoPoint(CREDS, device, f, clock).getCharge("ORD01");
    expect(r).toEqual({ status: expected, amountCents: 2400, ...(reason ? { failureReason: reason } : {}) });
    expect(calls[0].url).toBe("https://api.mercadopago.com/v1/orders/ORD01");
  });

  it("reads the amount from the first payment when the total is missing", async () => {
    const { f } = fakeFetch(() => ({
      json: { status: "processed", transactions: { payments: [{ amount: "5.50" }] } },
    }));
    expect((await mercadoPagoPoint(CREDS, device, f, clock).getCharge("o")).amountCents).toBe(550);
  });

  it("treats an unknown status as an error", async () => {
    const { f } = fakeFetch(() => ({ json: order("algo_novo") }));
    await expect(mercadoPagoPoint(CREDS, device, f, clock).getCharge("o")).rejects.toThrow();
  });

  it("cancels a pending order", async () => {
    const { f, calls } = fakeFetch(() => ({ json: order("canceled") }));
    await mercadoPagoPoint(CREDS, device, f, clock).cancelCardCharge("ORD01");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toBe("https://api.mercadopago.com/v1/orders/ORD01/cancel");
  });

  it("is idempotent: a refused cancel is fine when the order is already over", async () => {
    for (const final of ["canceled", "processed", "failed", "expired"]) {
      const { f } = fakeFetch((c: Call) =>
        c.url.endsWith("/cancel") ? { status: 409, json: {} } : { json: order(final) },
      );
      await expect(mercadoPagoPoint(CREDS, device, f, clock).cancelCardCharge("ORD01")).resolves.toBeUndefined();
    }
  });

  it("surfaces a refused cancel when the machine may still be waiting", async () => {
    const { f } = fakeFetch((c: Call) =>
      c.url.endsWith("/cancel") ? { status: 500, json: {} } : { json: order("at_terminal") },
    );
    await expect(mercadoPagoPoint(CREDS, device, f, clock).cancelCardCharge("ORD01")).rejects.toThrow(
      /mercadopago http 500/,
    );
  });

  it("does not hide a transport error behind the idempotency check", async () => {
    const f = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    await expect(mercadoPagoPoint(CREDS, device, f, clock).cancelCardCharge("ORD01")).rejects.toThrow(
      /network down/,
    );
  });

  it("is not reachable through the generic webhook parser", () => {
    expect(() => mercadoPagoPoint(CREDS, device, fakeFetch(() => ({})).f).parseWebhook(new Headers(), "{}")).toThrow(
      /handleMercadoPagoWebhook/,
    );
  });
});
