export type ChargeStatus = "pending" | "confirmed" | "expired" | "failed";

export type WebhookEvent = {
  externalId: string;
  status: "confirmed" | "expired" | "failed";
  amountCents: number;
};

export interface PaymentProvider {
  name: string;
  createPixCharge(i: {
    saleId: string;
    amountCents: number;
    expiresAt: Date;
  }): Promise<{ externalId: string; qrPayload: string; expiresAt: Date }>;
  getCharge(externalId: string): Promise<{ status: ChargeStatus; amountCents: number }>;
  /** Verifies the signature (throws when invalid). Returns null for events we do not care about. */
  parseWebhook(headers: Headers, rawBody: string): WebhookEvent | null;
}

/** Mutable so tests can shorten it. */
export const providerTimeout = { ms: 5000 };

/** Rejects with "provider timeout" when p does not settle within ms. */
export function withTimeout<T>(p: Promise<T>, ms: number = providerTimeout.ms): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("provider timeout")), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}
