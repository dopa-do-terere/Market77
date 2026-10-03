import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { ChargeStatus, PaymentProvider } from "./provider";

type Charge = { amountCents: number; status: ChargeStatus };

// ponytail: charge state lives in memory, for dev and tests only. A real adapter asks its provider instead.
const g = globalThis as unknown as { __m77fakePix?: Map<string, Charge> };
const charges = (g.__m77fakePix ??= new Map<string, Charge>());

/** Throws in production or without a secret; returns the webhook secret. */
function guard(): string {
  if (process.env.NODE_ENV === "production") throw new Error("fake Pix provider is disabled in production");
  const secret = process.env.FAKE_PIX_SECRET;
  if (!secret) throw new Error("Missing env var FAKE_PIX_SECRET");
  return secret;
}

const sign = (secret: string, body: string) => createHmac("sha256", secret).update(body).digest("hex");

const Event = z.object({
  externalId: z.string().min(1),
  status: z.enum(["confirmed", "expired", "failed"]),
  amountCents: z.number().int().min(0),
});

export const fakeProvider: PaymentProvider = {
  name: "fake",

  async createPixCharge({ amountCents, expiresAt }) {
    guard();
    const externalId = `fake_${randomUUID()}`;
    charges.set(externalId, { amountCents, status: "pending" });
    return { externalId, qrPayload: `FAKEPIX|${externalId}|${amountCents}`, expiresAt };
  },

  async getCharge(externalId) {
    guard();
    const c = charges.get(externalId);
    if (!c) throw new Error(`unknown fake charge ${externalId}`);
    return { status: c.status, amountCents: c.amountCents };
  },

  parseWebhook(headers, rawBody) {
    const secret = guard();
    const given = Buffer.from(headers.get("x-fake-signature") ?? "", "hex");
    const expected = Buffer.from(sign(secret, rawBody), "hex");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new Error("invalid signature");
    }
    return Event.parse(JSON.parse(rawBody));
  },
};

/**
 * Simulates the provider deciding the outcome of a charge and notifying us.
 * The signed body goes through the real webhook path, so production code is exercised.
 */
export function buildFakeWebhook(
  externalId: string,
  o: { status?: "confirmed" | "expired" | "failed"; amountCents?: number } = {},
): { headers: Headers; rawBody: string } {
  const secret = guard();
  const charge = charges.get(externalId);
  const status = o.status ?? "confirmed";
  if (charge) charge.status = status;
  const rawBody = JSON.stringify({
    externalId,
    status,
    amountCents: o.amountCents ?? charge?.amountCents ?? 0,
  });
  return { headers: new Headers({ "x-fake-signature": sign(secret, rawBody) }), rawBody };
}
