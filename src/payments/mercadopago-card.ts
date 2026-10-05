import { z } from "zod";
import type { MercadoPagoCredentials } from "@/domain/credentials";
import type { CardFailure, CardProvider } from "./card";
import { type Fetch, MercadoPagoError, mpCall } from "./mercadopago-http";
import type { ChargeStatus } from "./provider";

const Created = z.object({ id: z.string().min(1) });
const Order = z.object({
  status: z.string(),
  total_amount: z.union([z.string(), z.number()]).nullish(),
  transactions: z.object({ payments: z.array(z.object({ amount: z.union([z.string(), z.number()]) })) }).nullish(),
});

function toState(status: string): { status: ChargeStatus; failureReason?: CardFailure } {
  switch (status) {
    case "created":
    case "at_terminal":
    case "action_required":
      return { status: "pending" };
    case "processed":
      return { status: "confirmed" };
    case "canceled":
    case "refunded":
      return { status: "failed", failureReason: "cancelled" };
    case "failed":
      return { status: "failed", failureReason: "declined" };
    case "expired":
      return { status: "expired" };
    default:
      throw new Error(`unknown mercadopago order status ${status}`);
  }
}

/**
 * Card on a Mercado Pago Point machine, through the Orders API. The charge is an order sent to the machine
 * paired with the totem; debit or credit is chosen on the machine. deviceFor maps a Market77 terminal to its
 * Point id (terminals.point_device_id).
 */
export function mercadoPagoPoint(
  creds: MercadoPagoCredentials,
  deviceFor: (terminalId: string) => Promise<string | null>,
  f: Fetch = fetch,
  clock: () => Date = () => new Date(),
): CardProvider {
  async function getCharge(externalId: string) {
    const o = Order.parse(await mpCall(creds, f, "GET", `/v1/orders/${encodeURIComponent(externalId)}`));
    const amount = o.total_amount ?? o.transactions?.payments[0]?.amount;
    if (amount === undefined) throw new Error("mercadopago order without amount");
    return { ...toState(o.status), amountCents: Math.round(Number(amount) * 100) };
  }

  return {
    name: "mercadopago",

    async createCardCharge({ saleId, amountCents, terminalId, expiresAt }) {
      const device = await deviceFor(terminalId);
      if (!device) throw new Error("no Point machine paired with this terminal");
      const minutes = Math.max(1, Math.ceil((expiresAt.getTime() - clock().getTime()) / 60_000));
      const r = Created.parse(
        await mpCall(creds, f, "POST", "/v1/orders", {
          idempotencyKey: `${saleId}:${expiresAt.getTime()}`,
          body: {
            type: "point",
            external_reference: saleId,
            expiration_time: `PT${minutes}M`,
            transactions: { payments: [{ amount: (amountCents / 100).toFixed(2) }] },
            config: { point: { terminal_id: device, print_on_terminal: "no_ticket" } },
            description: "Compra no totem",
          },
        }),
      );
      return { externalId: r.id, expiresAt };
    },

    async cancelCardCharge(externalId) {
      try {
        await mpCall(creds, f, "POST", `/v1/orders/${encodeURIComponent(externalId)}/cancel`);
      } catch (e) {
        if (!(e instanceof MercadoPagoError)) throw e;
        // Refused: fine when the order is already over (cancelled, paid, expired); otherwise the machine may still wait.
        if ((await getCharge(externalId)).status === "pending") throw e;
      }
    },

    getCharge,

    parseWebhook() {
      // Notifications only say that an id changed: handleMercadoPagoWebhook verifies and asks the API.
      throw new Error("mercadopago notifications go through handleMercadoPagoWebhook");
    },
  };
}
