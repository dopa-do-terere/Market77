import { z } from "zod";
import type { Tx } from "@/db/tenant";
import { AppError } from "@/lib/errors";
import { parse } from "@/lib/validate";

export const CART_TTL_MS = 5 * 60_000;
export const MAX_QUANTITY = 99;
export const MAX_TOTAL_CENTS = 1_000_000;

export type SaleStatus = "open" | "awaiting_payment" | "paid" | "cancelled" | "expired";
export type TerminalCtx = { terminalId: string; marketId: string };
export type SaleItemView = {
  id: string;
  marketProductId: string;
  productName: string;
  quantity: number;
  unitPriceCents: number;
};
export type PaymentView = {
  id: string;
  status: "pending" | "confirmed" | "expired" | "failed";
  amountCents: number;
  qrPayload: string;
  expiresAt: Date;
};
export type SaleView = {
  id: string;
  status: SaleStatus;
  totalCents: number;
  expiresAt: Date;
  items: SaleItemView[];
  payment: PaymentView | null;
};
export type LockedSale = { id: string; status: SaleStatus; expiresAt: Date };

const uuid = z.string().uuid();
const plus = (d: Date, ms: number) => new Date(d.getTime() + ms);

/**
 * Locks the sale row (serializes concurrent edits and payment steps) and lazily expires an abandoned cart.
 * A malformed id, another terminal's sale and another tenant's sale all read as sale_not_found.
 * If the caller then throws, the transaction rolls back the expiry write too; the next lock redoes it.
 */
export async function lockSale(tx: Tx, term: TerminalCtx, saleId: string, now: Date): Promise<LockedSale> {
  if (!uuid.safeParse(saleId).success) throw new AppError("sale_not_found");
  const [row] = await tx`
    select id, status, expires_at from sales
    where id = ${saleId} and terminal_id = ${term.terminalId} for update`;
  if (!row) throw new AppError("sale_not_found");
  const expiresAt = row.expires_at as Date;
  if (row.status === "open" && expiresAt < now) {
    await tx`update sales set status = 'expired' where id = ${saleId}`;
    return { id: saleId, status: "expired", expiresAt };
  }
  return { id: saleId, status: row.status as SaleStatus, expiresAt };
}

export async function getSaleView(tx: Tx, saleId: string): Promise<SaleView> {
  const [s] = await tx`select id, status, total_cents, expires_at from sales where id = ${saleId}`;
  if (!s) throw new AppError("sale_not_found");
  const items = await tx`
    select id, market_product_id, product_name, quantity, unit_price_cents
    from sale_items where sale_id = ${saleId} order by product_name, id`;
  const [p] = await tx`
    select id, status, amount_cents, qr_payload, expires_at
    from payments where sale_id = ${saleId} order by created_at desc limit 1`;
  return {
    id: s.id as string,
    status: s.status as SaleStatus,
    totalCents: s.total_cents as number,
    expiresAt: s.expires_at as Date,
    items: items.map((i) => ({
      id: i.id as string,
      marketProductId: i.market_product_id as string,
      productName: i.product_name as string,
      quantity: i.quantity as number,
      unitPriceCents: i.unit_price_cents as number,
    })),
    payment: p
      ? {
          id: p.id as string,
          status: p.status as PaymentView["status"],
          amountCents: p.amount_cents as number,
          qrPayload: p.qr_payload as string,
          expiresAt: p.expires_at as Date,
        }
      : null,
  };
}

/** Recomputes the total from the items, enforces the cap and renews the inactivity window. */
async function recalc(tx: Tx, saleId: string, now: Date): Promise<void> {
  const [t] = await tx`
    select coalesce(sum(quantity::bigint * unit_price_cents), 0)::bigint as total
    from sale_items where sale_id = ${saleId}`;
  const total = Number(t.total);
  if (total > MAX_TOTAL_CENTS) throw new AppError("sale_too_large");
  await tx`update sales set total_cents = ${total}, expires_at = ${plus(now, CART_TTL_MS)} where id = ${saleId}`;
}

const Scan = z.object({ saleId: z.string().optional(), barcode: z.string().trim().min(1).max(64) });

/** Adds one unit of the product with this barcode, creating the sale when saleId is absent. */
export async function addItemByBarcode(
  tx: Tx,
  orgId: string,
  term: TerminalCtx,
  raw: unknown,
  now: Date,
): Promise<SaleView> {
  const i = parse(Scan, raw);
  const [mp] = await tx`
    select mp.id, mp.price_cents, mp.active, p.name
    from product_barcodes b
    join market_products mp on mp.product_id = b.product_id and mp.market_id = ${term.marketId}
    join products p on p.id = b.product_id
    where b.code = ${i.barcode}`;
  if (!mp) throw new AppError("product_not_found");
  if (!mp.active) throw new AppError("product_inactive");

  let saleId: string;
  if (i.saleId) {
    const sale = await lockSale(tx, term, i.saleId, now);
    if (sale.status !== "open") throw new AppError("sale_not_editable");
    saleId = sale.id;
  } else {
    const [s] = await tx`
      insert into sales (org_id, market_id, terminal_id, expires_at)
      values (${orgId}, ${term.marketId}, ${term.terminalId}, ${plus(now, CART_TTL_MS)}) returning id`;
    saleId = s.id as string;
  }

  const [existing] = await tx`
    select quantity from sale_items where sale_id = ${saleId} and market_product_id = ${mp.id}`;
  if (existing && (existing.quantity as number) >= MAX_QUANTITY) throw new AppError("quantity_limit");
  if (existing) {
    await tx`update sale_items set quantity = quantity + 1 where sale_id = ${saleId} and market_product_id = ${mp.id}`;
  } else {
    await tx`
      insert into sale_items (org_id, sale_id, market_product_id, product_name, quantity, unit_price_cents)
      values (${orgId}, ${saleId}, ${mp.id}, ${mp.name}, 1, ${mp.price_cents})`;
  }
  await recalc(tx, saleId, now);
  return getSaleView(tx, saleId);
}

const Qty = z.object({ itemId: z.string(), quantity: z.number().int().min(0).max(MAX_QUANTITY) });

export async function setItemQuantity(
  tx: Tx,
  term: TerminalCtx,
  saleId: string,
  raw: unknown,
  now: Date,
): Promise<SaleView> {
  const i = parse(Qty, raw);
  const sale = await lockSale(tx, term, saleId, now);
  if (sale.status !== "open") throw new AppError("sale_not_editable");
  if (!uuid.safeParse(i.itemId).success) throw new AppError("not_found");
  const rows =
    i.quantity === 0
      ? await tx`delete from sale_items where id = ${i.itemId} and sale_id = ${sale.id} returning id`
      : await tx`update sale_items set quantity = ${i.quantity} where id = ${i.itemId} and sale_id = ${sale.id} returning id`;
  if (rows.length === 0) throw new AppError("not_found");
  await recalc(tx, sale.id, now);
  return getSaleView(tx, sale.id);
}

export async function cancelSale(tx: Tx, term: TerminalCtx, saleId: string, now: Date): Promise<SaleView> {
  const sale = await lockSale(tx, term, saleId, now);
  if (sale.status !== "open") throw new AppError("sale_not_editable");
  await tx`update sales set status = 'cancelled' where id = ${sale.id}`;
  return getSaleView(tx, sale.id);
}
