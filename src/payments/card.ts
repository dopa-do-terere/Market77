import type { ChargeStatus } from "./provider";

export type CardFailure = "declined" | "cancelled";

export type CardWebhookEvent = {
  externalId: string;
  status: "confirmed" | "expired" | "failed";
  amountCents: number;
  failureReason?: CardFailure;
};

export interface CardProvider {
  name: string;
  createCardCharge(i: {
    saleId: string;
    amountCents: number;
    terminalId: string;
    expiresAt: Date;
  }): Promise<{ externalId: string; expiresAt: Date }>;
  /** Tells the machine to stop waiting. Idempotent; never cancels a charge that was already approved. */
  cancelCardCharge(externalId: string): Promise<void>;
  getCharge(
    externalId: string,
  ): Promise<{ status: ChargeStatus; amountCents: number; failureReason?: CardFailure }>;
  /** Verifies the signature (throws when invalid). Returns null for events we do not care about. */
  parseWebhook(headers: Headers, rawBody: string): CardWebhookEvent | null;
}
