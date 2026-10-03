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
