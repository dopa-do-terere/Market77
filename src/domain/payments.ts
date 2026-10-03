import type { Tx } from "@/db/tenant";
import { AppError } from "@/lib/errors";
import type { PaymentProvider } from "@/payments/provider";
import { type SaleView, type TerminalCtx, getSaleView, lockSale } from "./sales";

export const QR_TTL_MS = 3 * 60_000;

/**
 * Freezes the total and creates the Pix charge. A still-valid pending charge is returned as is.
 * ponytail: the provider call runs inside the transaction (holding the sale lock);
 * move it out if provider latency ever hurts.
 */
export async function startPayment(
  tx: Tx,
  orgId: string,
  term: TerminalCtx,
  saleId: string,
  provider: PaymentProvider,
  now: Date,
): Promise<SaleView> {
  const sale = await lockSale(tx, term, saleId, now);
  if (sale.status === "awaiting_payment") {
    const [pending] = await tx`
      select id from payments where sale_id = ${sale.id} and status = 'pending' and expires_at > ${now}`;
    if (pending) return getSaleView(tx, sale.id);
    await tx`update payments set status = 'expired' where sale_id = ${sale.id} and status = 'pending'`;
  } else if (sale.status !== "open") {
    throw new AppError("sale_not_editable");
  }

  const [t] = await tx`select total_cents from sales where id = ${sale.id}`;
  const [c] = await tx`select count(*)::int as n from sale_items where sale_id = ${sale.id}`;
  if (c.n === 0) throw new AppError("sale_empty");
  const amountCents = t.total_cents as number;
  const expiresAt = new Date(now.getTime() + QR_TTL_MS);

  let charge: Awaited<ReturnType<PaymentProvider["createPixCharge"]>>;
  try {
    charge = await provider.createPixCharge({ saleId: sale.id, amountCents, expiresAt });
  } catch {
    throw new AppError("provider_unavailable");
  }
  await tx`
    insert into payments (org_id, sale_id, provider, external_id, amount_cents, qr_payload, expires_at)
    values (${orgId}, ${sale.id}, ${provider.name}, ${charge.externalId}, ${amountCents}, ${charge.qrPayload}, ${charge.expiresAt})`;
  await tx`update sales set status = 'awaiting_payment' where id = ${sale.id}`;
  return getSaleView(tx, sale.id);
}

export type ConfirmResult = "confirmed" | "already_confirmed" | "rejected";

/**
 * Settles a payment: sale becomes paid and each item leaves stock, in one transaction.
 * A confirmed payment is never refused for stock reasons (balance may go negative).
 * Rejected (payment kept as failed, visible to the owner): wrong amount, cancelled sale,
 * or a sale already paid by another payment. Safe to call any number of times.
 */
export async function confirmPayment(
  tx: Tx,
  paymentId: string,
  paidAmountCents: number,
  event: unknown,
  now: Date,
): Promise<ConfirmResult> {
  const [ref] = await tx`select sale_id from payments where id = ${paymentId}`;
  if (!ref) throw new AppError("not_found");
  // Lock order is always sale, then payment (startPayment locks the sale first too): no deadlock.
  const [sale] = await tx`select id, status from sales where id = ${ref.sale_id} for update`;
  const [pay] = await tx`select status, amount_cents from payments where id = ${paymentId} for update`;
  if (pay.status === "confirmed") return "already_confirmed";

  const detail = tx.json({ paidAmountCents, event } as never);
  if (paidAmountCents !== pay.amount_cents || sale.status === "cancelled" || sale.status === "paid") {
    await tx`update payments set status = 'failed', webhook_payload = ${detail} where id = ${paymentId}`;
    return "rejected";
  }
  await tx`update payments set status = 'confirmed', webhook_payload = ${detail} where id = ${paymentId}`;
  await tx`update sales set status = 'paid', paid_at = ${now} where id = ${sale.id}`;
  await tx`
    insert into stock_movements (org_id, market_product_id, type, quantity, sale_id)
    select org_id, market_product_id, 'sale', -quantity, sale_id from sale_items where sale_id = ${sale.id}`;
  return "confirmed";
}
