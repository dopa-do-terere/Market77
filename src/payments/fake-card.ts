import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { CardFailure, CardProvider } from "./card";
import type { ChargeStatus } from "./provider";

type Charge = { amountCents: number; status: ChargeStatus; failureReason?: CardFailure };

// ponytail: charge state lives in memory, for dev and tests only. A real adapter asks its provider instead.
const g = globalThis as unknown as { __m77fakeCard?: Map<string, Charge> };
const charges = (g.__m77fakeCard ??= new Map<string, Charge>());

/** Throws in production or without a secret; returns the webhook secret. */
function guard(): string {
  if (process.env.NODE_ENV === "production") throw new Error("fake card provider is disabled in production");
  const secret = process.env.FAKE_CARD_SECRET;
  if (!secret) throw new Error("Missing env var FAKE_CARD_SECRET");
  return secret;
}

const sign = (secret: string, body: string) => createHmac("sha256", secret).update(body).digest("hex");

const Event = z.object({
  externalId: z.string().min(1),
  status: z.enum(["confirmed", "expired", "failed"]),
  amountCents: z.number().int().min(0),
  failureReason: z.enum(["declined", "cancelled"]).optional(),
});

export const fakeCardProvider: CardProvider = {
  name: "fake",

  async createCardCharge({ amountCents, expiresAt }) {
    guard();
    const externalId = `fakecard_${randomUUID()}`;
    charges.set(externalId, { amountCents, status: "pending" });
    return { externalId, expiresAt };
  },

  async cancelCardCharge(externalId) {
    guard();
    const c = charges.get(externalId);
    if (c && c.status === "pending") {
      c.status = "failed";
      c.failureReason = "cancelled";
    }
  },

  async getCharge(externalId) {
    guard();
    const c = charges.get(externalId);
    if (!c) throw new Error(`unknown fake card charge ${externalId}`);
    return {
      status: c.status,
      amountCents: c.amountCents,
      ...(c.failureReason ? { failureReason: c.failureReason } : {}),
    };
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
 * Simulates the machine deciding the outcome of a charge and the provider notifying us.
 * The signed body goes through the real webhook path, so production code is exercised.
 */
export function buildFakeCardWebhook(
  externalId: string,
  o: { status?: "confirmed" | "expired" | "failed"; failureReason?: CardFailure; amountCents?: number } = {},
): { headers: Headers; rawBody: string } {
  const secret = guard();
  const charge = charges.get(externalId);
  const status = o.status ?? "confirmed";
  if (charge) {
    charge.status = status;
    if (o.failureReason) charge.failureReason = o.failureReason;
  }
  const rawBody = JSON.stringify({
    externalId,
    status,
    amountCents: o.amountCents ?? charge?.amountCents ?? 0,
    ...(o.failureReason ? { failureReason: o.failureReason } : {}),
  });
  return { headers: new Headers({ "x-fake-signature": sign(secret, rawBody) }), rawBody };
}
