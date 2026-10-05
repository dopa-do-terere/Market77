import type { Tx } from "@/db/tenant";
import type { CardProvider } from "@/payments/card";
import { type PaymentProvider, type ChargeStatus, withTimeout } from "@/payments/provider";
import { resolveCard } from "@/payments/registry";
import { confirmPayment, failPayment } from "./payments";
import { type SaleView, type TerminalCtx, getSaleView, lockSale, reopenSale } from "./sales";

export const CHECK_INTERVAL_MS = 10_000;
export const CARD_CHECK_INTERVAL_MS = 2_000;

type Charge = { status: ChargeStatus; amountCents: number; failureReason?: "declined" | "cancelled" };

/**
 * Runs on every read of a sale. Expires an abandoned cart and reconciles a pending payment with
 * its provider (Pix at most every CHECK_INTERVAL_MS, card every CARD_CHECK_INTERVAL_MS), covering a
 * lost webhook. An old QR or an unanswered card with nothing confirmed expires and the sale returns
 * to open with the cart intact; a payment that still arrives later is accepted by confirmPayment.
 * ponytail: the provider call runs inside the transaction (holding the sale lock).
 */
export async function refreshSale(
  tx: Tx,
  term: TerminalCtx,
  saleId: string,
  provider: PaymentProvider,
  now: Date,
  card?: CardProvider,
): Promise<SaleView> {
  const sale = await lockSale(tx, term, saleId, now);
  if (sale.status === "awaiting_payment") {
    const [p] = await tx`
      select id, method, external_id, expires_at, checked_at from payments
      where sale_id = ${sale.id} and status = 'pending'`;
    if (!p) {
      await reopenSale(tx, sale.id, now); // the last payment already expired or failed
    } else {
      const isCard = p.method === "card";
      const interval = isCard ? CARD_CHECK_INTERVAL_MS : CHECK_INTERVAL_MS;
      if (!p.checked_at || now.getTime() - (p.checked_at as Date).getTime() >= interval) {
        let source: CardProvider | undefined;
        let charge: Charge | null = null;
        try {
          if (isCard) {
            source = card ?? (await resolveCard(tx));
            charge = await withTimeout(source.getCharge(p.external_id as string));
          } else {
            charge = await withTimeout(provider.getCharge(p.external_id as string));
          }
        } catch {
          // provider down or unknown: keep waiting, or let an old charge expire below
        }
        await tx`update payments set checked_at = ${now} where id = ${p.id}`;
        if (charge?.status === "confirmed") {
          const result = await confirmPayment(tx, p.id as string, charge.amountCents, { source: "reconcile" }, now);
          if (result === "rejected") await reopenSale(tx, sale.id, now); // the payment was marked failed
        } else if (charge?.status === "failed") {
          // A failed Pix keeps no reason, so the owner panel flags it as before.
          await failPayment(tx, p.id as string, isCard ? (charge.failureReason ?? "declined") : null, now);
        } else if (charge?.status === "expired" || (p.expires_at as Date) <= now) {
          if (!isCard) {
            await failPayment(tx, p.id as string, "expired", now);
          } else if (source) {
            // Never discard an approval: stop the machine, ask again, and only then expire.
            // Unknown terminal state leaves the payment pending; the next refresh retries.
            let stopped = true;
            try {
              await withTimeout(source.cancelCardCharge(p.external_id as string));
            } catch {
              stopped = false;
            }
            let final: Charge | null = null;
            try {
              final = await withTimeout(source.getCharge(p.external_id as string));
            } catch {
              // unknown: keep waiting
            }
            if (final?.status === "confirmed") {
              const result = await confirmPayment(tx, p.id as string, final.amountCents, { source: "reconcile" }, now);
              if (result === "rejected") await reopenSale(tx, sale.id, now);
            } else if (final && (stopped || final.status !== "pending")) {
              await failPayment(tx, p.id as string, "expired", now);
            }
          }
        }
      }
    }
  }
  return getSaleView(tx, sale.id);
}
