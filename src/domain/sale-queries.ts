import { z } from "zod";
import type { Tx } from "@/db/tenant";

export type SaleListRow = {
  id: string;
  marketName: string;
  timezone: string;
  status: string;
  totalCents: number;
  itemCount: number;
  createdAt: Date;
};

export type SaleDetail = {
  id: string;
  marketName: string;
  timezone: string;
  status: string;
  totalCents: number;
  createdAt: Date;
  paidAt: Date | null;
  items: { productName: string; quantity: number; unitPriceCents: number }[];
  payments: {
    id: string;
    status: string;
    provider: string;
    amountCents: number;
    paidAmountCents: number | null;
    createdAt: Date;
  }[];
};

export async function listRecentSales(tx: Tx, limit = 50): Promise<SaleListRow[]> {
  const rows = await tx`
    select s.id, m.name as market_name, m.timezone, s.status, s.total_cents, s.created_at,
      (select coalesce(sum(i.quantity), 0)::int from sale_items i where i.sale_id = s.id) as item_count
    from sales s join markets m on m.id = s.market_id
    where exists (select 1 from sale_items i where i.sale_id = s.id)
    order by s.created_at desc limit ${limit}`;
  return rows.map((r) => ({
    id: r.id as string,
    marketName: r.market_name as string,
    timezone: r.timezone as string,
    status: r.status as string,
    totalCents: r.total_cents as number,
    itemCount: r.item_count as number,
    createdAt: r.created_at as Date,
  }));
}

export async function getSaleDetail(tx: Tx, saleId: string): Promise<SaleDetail | null> {
  if (!z.string().uuid().safeParse(saleId).success) return null;
  const [s] = await tx`
    select s.id, m.name as market_name, m.timezone, s.status, s.total_cents, s.created_at, s.paid_at
    from sales s join markets m on m.id = s.market_id where s.id = ${saleId}`;
  if (!s) return null;
  const items = await tx`
    select product_name, quantity, unit_price_cents from sale_items
    where sale_id = ${saleId} order by product_name, id`;
  const payments = await tx`
    select id, status, provider, amount_cents, (webhook_payload->>'paidAmountCents')::int as paid_amount_cents, created_at
    from payments where sale_id = ${saleId} order by created_at, id`;
  return {
    id: s.id as string,
    marketName: s.market_name as string,
    timezone: s.timezone as string,
    status: s.status as string,
    totalCents: s.total_cents as number,
    createdAt: s.created_at as Date,
    paidAt: (s.paid_at as Date | null) ?? null,
    items: items.map((i) => ({
      productName: i.product_name as string,
      quantity: i.quantity as number,
      unitPriceCents: i.unit_price_cents as number,
    })),
    payments: payments.map((p) => ({
      id: p.id as string,
      status: p.status as string,
      provider: p.provider as string,
      amountCents: p.amount_cents as number,
      paidAmountCents: (p.paid_amount_cents as number | null) ?? null,
      createdAt: p.created_at as Date,
    })),
  };
}

/** Paid sales whose paid_at falls on today's date in each market's own time zone. */
export async function salesToday(tx: Tx, now: Date = new Date()): Promise<{ totalCents: number; count: number }> {
  const [r] = await tx`
    select coalesce(sum(s.total_cents), 0)::bigint as total, count(*)::int as n
    from sales s join markets m on m.id = s.market_id
    where s.status = 'paid'
      and (s.paid_at at time zone m.timezone)::date = (${now}::timestamptz at time zone m.timezone)::date`;
  return { totalCents: Number(r.total), count: r.n as number };
}
