import { z } from "zod";
import type { MercadoPagoCredentials } from "@/domain/credentials";
import { type Fetch, mpCall } from "./mercadopago-http";
import type { ChargeStatus, PaymentProvider } from "./provider";

const MIN_EXPIRY_MS = 31 * 60_000; // Mercado Pago refuses a Pix that expires in less than 30 minutes

const Created = z.object({
  id: z.union([z.string(), z.number()]),
  point_of_interaction: z.object({ transaction_data: z.object({ qr_code: z.string().min(1) }) }),
});
const Payment = z.object({
  status: z.string(),
  status_detail: z.string().nullish(),
  transaction_amount: z.number(),
});

function toStatus(status: string, detail: string | null | undefined): ChargeStatus {
  switch (status) {
    case "approved":
      return "confirmed";
    case "pending":
    case "in_process":
    case "authorized":
      return "pending";
    case "cancelled":
      return detail === "expired" ? "expired" : "failed";
    case "rejected":
    case "refunded":
    case "charged_back":
      return "failed";
    default:
      throw new Error(`unknown mercadopago status ${status}`);
  }
}

/**
 * Pix through the Payments API. The Market77 payment expires sooner than the Pix does (the provider needs
 * 30 minutes at least); a late approval is still checked against the sale total by confirmPayment.
 */
export function mercadoPagoPix(
  creds: MercadoPagoCredentials,
  f: Fetch = fetch,
  clock: () => Date = () => new Date(),
  payerEmail = "cliente@market77.invalid",
): PaymentProvider {
  return {
    name: "mercadopago",

    async createPixCharge({ saleId, amountCents, expiresAt }) {
      const providerExpiry = new Date(Math.max(expiresAt.getTime(), clock().getTime() + MIN_EXPIRY_MS));
      const r = Created.parse(
        await mpCall(creds, f, "POST", "/v1/payments", {
          idempotencyKey: `${saleId}:${expiresAt.getTime()}`,
          body: {
            transaction_amount: Number((amountCents / 100).toFixed(2)),
            payment_method_id: "pix",
            date_of_expiration: providerExpiry.toISOString(),
            external_reference: saleId,
            description: "Compra no totem",
            payer: { email: payerEmail },
          },
        }),
      );
      return { externalId: String(r.id), qrPayload: r.point_of_interaction.transaction_data.qr_code, expiresAt };
    },

    async getCharge(externalId) {
      const p = Payment.parse(await mpCall(creds, f, "GET", `/v1/payments/${encodeURIComponent(externalId)}`));
      return { status: toStatus(p.status, p.status_detail), amountCents: Math.round(p.transaction_amount * 100) };
    },

    parseWebhook() {
      // Notifications only say that an id changed: handleMercadoPagoWebhook verifies and asks the API.
      throw new Error("mercadopago notifications go through handleMercadoPagoWebhook");
    },
  };
}
