import type { Tx } from "@/db/tenant";
import { type PaymentProvider, withTimeout } from "@/payments/provider";
import { confirmPayment } from "./payments";
import { CART_TTL_MS, type SaleView, type TerminalCtx, getSaleView, lockSale } from "./sales";

export const CHECK_INTERVAL_MS = 10_000;

async function reopen(tx: Tx, saleId: string, now: Date): Promise<void> {
  await tx`
    update sales set status = 'open', expires_at = ${new Date(now.getTime() + CART_TTL_MS)}
    where id = ${saleId}`;
}

/**
 * Runs on every read of a sale. Expires an abandoned cart and reconciles a pending payment with
 * the provider (at most once per CHECK_INTERVAL_MS), covering a lost webhook. An old QR with no
 * payment confirmed expires and the sale returns to open with the cart intact; a payment that
 * still arrives later is accepted by confirmPayment.
 * ponytail: the provider call runs inside the transaction (holding the sale lock).
 */
export async function refreshSale(
  tx: Tx,
  term: TerminalCtx,
  saleId: string,
  provider: PaymentProvider,
  now: Date,
): Promise<SaleView> {
  const sale = await lockSale(tx, term, saleId, now);
  if (sale.status === "awaiting_payment") {
    const [p] = await tx`
      select id, external_id, expires_at, checked_at from payments
      where sale_id = ${sale.id} and status = 'pending'`;
    if (!p) {
      await reopen(tx, sale.id, now); // the last payment already expired or failed
    } else if (!p.checked_at || now.getTime() - (p.checked_at as Date).getTime() >= CHECK_INTERVAL_MS) {
      let charge: Awaited<ReturnType<PaymentProvider["getCharge"]>> | null = null;
      try {
        charge = await withTimeout(provider.getCharge(p.external_id as string));
      } catch {
        // provider down: keep waiting, or let an old QR expire below
      }
      await tx`update payments set checked_at = ${now} where id = ${p.id}`;
      if (charge?.status === "confirmed") {
        const result = await confirmPayment(tx, p.id as string, charge.amountCents, { source: "reconcile" }, now);
        if (result === "rejected") await reopen(tx, sale.id, now); // the payment was marked failed
      } else if (charge?.status === "failed") {
        await tx`update payments set status = 'failed' where id = ${p.id}`;
        await reopen(tx, sale.id, now);
      } else if (charge?.status === "expired" || (p.expires_at as Date) <= now) {
        await tx`update payments set status = 'expired' where id = ${p.id}`;
        await reopen(tx, sale.id, now);
      }
    }
  }
  return getSaleView(tx, sale.id);
}
