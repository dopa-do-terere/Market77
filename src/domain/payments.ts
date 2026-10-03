import type postgres from "postgres";
import { z } from "zod";
import type { Tx } from "@/db/tenant";
import { AppError } from "@/lib/errors";
import type { CardProvider } from "@/payments/card";
import { type PaymentProvider, withTimeout } from "@/payments/provider";
import { getCardProvider } from "@/payments/registry";
import { type SaleView, type TerminalCtx, getSaleView, lockSale, reopenSale } from "./sales";
import { debitSale } from "./stock";

export const QR_TTL_MS = 3 * 60_000;
export const CARD_TTL_MS = 2 * 60_000;

export type PayMethod = "pix" | "card";
export type FailReason = "declined" | "cancelled" | "expired";

const isUuid = (s: string) => z.string().uuid().safeParse(s).success;

function cardProviderOrThrow(card?: CardProvider): CardProvider {
  if (card) return card;
  try {
    return getCardProvider();
  } catch {
    throw new AppError("provider_unavailable");
  }
}

/**
 * Ends a pending payment on behalf of the customer. A card charge is cancelled on the machine first;
 * if that fails the payment stays pending (the machine may still charge) and the caller gets
 * provider_unavailable. When the machine had already approved, the sale is paid instead.
 * Returns "paid" or "ended"; after "ended" the caller puts the sale back at the cart or starts a new payment.
 */
async function endPending(
  tx: Tx,
  p: postgres.Row,
  card: CardProvider | undefined,
  now: Date,
): Promise<"paid" | "ended"> {
  const stillValid = (p.expires_at as Date) > now;
  const externalId = p.external_id as string;
  if (p.method === "card") {
    const provider = cardProviderOrThrow(card);
    // Always ask the machine, even after the charge ran out: an approval whose webhook is late must win.
    let approvedCents: number | null = null;
    try {
      let stopped = true;
      try {
        await withTimeout(provider.cancelCardCharge(externalId));
      } catch (e) {
        if (stillValid) throw e;
        stopped = false; // tolerable for a run-out charge, as long as the machine is no longer waiting
      }
      const c = await withTimeout(provider.getCharge(externalId));
      if (!stopped && c.status === "pending") throw new Error("machine still waiting");
      if (c.status === "confirmed") approvedCents = c.amountCents;
    } catch {
      throw new AppError("provider_unavailable");
    }
    if (approvedCents !== null) {
      const result = await confirmPayment(tx, p.id as string, approvedCents, { source: "cancel" }, now);
      return result === "rejected" ? "ended" : "paid";
    }
  }
  await tx`
    update payments set status = 'expired', failure_reason = ${stillValid ? "cancelled" : "expired"}
    where id = ${p.id} and status = 'pending'`;
  return "ended";
}

/**
 * Freezes the total and creates the charge (Pix by default, or card on the machine).
 * A still-valid pending charge of the same method is returned as is; a pending one of the other
 * method (or an expired one) is ended first, so a sale never has two pending payments.
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
  opts: { method?: PayMethod; card?: CardProvider } = {},
): Promise<SaleView> {
  const method: PayMethod = opts.method ?? "pix";
  const sale = await lockSale(tx, term, saleId, now);
  if (sale.status === "awaiting_payment") {
    const [pending] = await tx`
      select id, method, external_id, expires_at from payments where sale_id = ${sale.id} and status = 'pending'`;
    if (pending && pending.method === method && (pending.expires_at as Date) > now) {
      return getSaleView(tx, sale.id);
    }
    if (pending && (await endPending(tx, pending, opts.card, now)) === "paid") return getSaleView(tx, sale.id);
  } else if (sale.status !== "open") {
    throw new AppError("sale_not_editable");
  }

  const [t] = await tx`select total_cents from sales where id = ${sale.id}`;
  const [c] = await tx`select count(*)::int as n from sale_items where sale_id = ${sale.id}`;
  if (c.n === 0) throw new AppError("sale_empty");
  const amountCents = t.total_cents as number;
  const expiresAt = new Date(now.getTime() + (method === "card" ? CARD_TTL_MS : QR_TTL_MS));

  if (method === "card") {
    const card = cardProviderOrThrow(opts.card);
    let charge: Awaited<ReturnType<CardProvider["createCardCharge"]>>;
    try {
      charge = await withTimeout(
        card.createCardCharge({ saleId: sale.id, amountCents, terminalId: term.terminalId, expiresAt }),
      );
    } catch {
      throw new AppError("provider_unavailable");
    }
    await tx`
      insert into payments (org_id, sale_id, method, provider, external_id, amount_cents, qr_payload, expires_at)
      values (${orgId}, ${sale.id}, 'card', ${card.name}, ${charge.externalId}, ${amountCents}, null, ${charge.expiresAt})`;
  } else {
    let charge: Awaited<ReturnType<PaymentProvider["createPixCharge"]>>;
    try {
      charge = await withTimeout(provider.createPixCharge({ saleId: sale.id, amountCents, expiresAt }));
    } catch {
      throw new AppError("provider_unavailable");
    }
    await tx`
      insert into payments (org_id, sale_id, method, provider, external_id, amount_cents, qr_payload, expires_at)
      values (${orgId}, ${sale.id}, 'pix', ${provider.name}, ${charge.externalId}, ${amountCents}, ${charge.qrPayload}, ${charge.expiresAt})`;
  }
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
  const [sale] = await tx`select id, status, total_cents from sales where id = ${ref.sale_id} for update`;
  const [pay] = await tx`select status, amount_cents from payments where id = ${paymentId} for update`;
  if (pay.status === "confirmed") return "already_confirmed";

  const detail = tx.json({ paidAmountCents, event } as postgres.JSONValue);
  // The total is frozen at startPayment; it differs only if the cart was edited after the QR expired.
  if (
    paidAmountCents !== pay.amount_cents ||
    pay.amount_cents !== sale.total_cents ||
    sale.status === "cancelled" ||
    sale.status === "paid"
  ) {
    // No reason: a rejected payment is what "needs attention" means in the owner panel.
    await tx`update payments set status = 'failed', failure_reason = null, webhook_payload = ${detail} where id = ${paymentId}`;
    return "rejected";
  }
  await tx`update payments set status = 'confirmed', failure_reason = null, webhook_payload = ${detail} where id = ${paymentId}`;
  // No failure_reason on the ended ones: a late approval of one of them is rejected and stays flagged.
  const ended = await tx`
    update payments set status = 'expired' where sale_id = ${sale.id} and status = 'pending' and id <> ${paymentId}
    returning method, external_id`;
  await tx`update sales set status = 'paid', paid_at = ${now} where id = ${sale.id}`;
  await debitSale(tx, sale.id as string);
  for (const e of ended) {
    if (e.method !== "card") continue;
    // ponytail: best-effort stop of the machine, no retry; a charge it still approves is rejected above.
    try {
      await withTimeout(getCardProvider().cancelCardCharge(e.external_id as string));
    } catch {
      // provider down or unknown: the payment is already ended here
    }
  }
  return "confirmed";
}

/**
 * The customer gives up on the payment. The sale goes back to the cart with the items intact.
 * Idempotent for a sale that is already at the cart; a sale that is not open or awaiting payment
 * cannot be changed. See endPending for what happens on the machine.
 */
export async function cancelPayment(
  tx: Tx,
  term: TerminalCtx,
  saleId: string,
  now: Date,
  card?: CardProvider,
): Promise<SaleView> {
  const sale = await lockSale(tx, term, saleId, now);
  if (sale.status === "open") return getSaleView(tx, sale.id);
  if (sale.status !== "awaiting_payment") throw new AppError("sale_not_editable");
  const [p] = await tx`
    select id, method, external_id, expires_at from payments where sale_id = ${sale.id} and status = 'pending'`;
  if (p && (await endPending(tx, p, card, now)) === "paid") return getSaleView(tx, sale.id);
  await reopenSale(tx, sale.id, now);
  return getSaleView(tx, sale.id);
}

/**
 * Marks a pending payment failed (declined or cancelled on the machine; null reason for a Pix the
 * provider failed, which the owner panel flags) or expired, and puts the sale
 * back at the cart. Only a pending payment changes, so a late or repeated event is harmless and a
 * confirmed payment is never reverted. Returns whether anything changed.
 */
export async function failPayment(tx: Tx, paymentId: string, reason: FailReason | null, now: Date): Promise<boolean> {
  if (!isUuid(paymentId)) throw new AppError("not_found");
  const [ref] = await tx`select sale_id from payments where id = ${paymentId}`;
  if (!ref) throw new AppError("not_found");
  // Lock order is always sale, then payment, like confirmPayment and startPayment.
  const [sale] = await tx`select id, status from sales where id = ${ref.sale_id} for update`;
  const [pay] = await tx`select status from payments where id = ${paymentId} for update`;
  if (pay.status !== "pending") return false;
  await tx`
    update payments set status = ${reason === "expired" ? "expired" : "failed"}, failure_reason = ${reason}
    where id = ${paymentId}`;
  if (sale.status === "awaiting_payment") await reopenSale(tx, sale.id as string, now);
  return true;
}
