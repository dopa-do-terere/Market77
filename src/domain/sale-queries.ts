import { z } from "zod";
import type { Tx } from "@/db/tenant";
import { maskCpf } from "@/lib/tax-id";

export type FiscalView = {
  status: string;
  attempts: number;
  number: number | null;
  accessKey: string | null;
  danfeUrl: string | null;
  lastError: string | null;
};

export type SaleListRow = {
  id: string;
  marketName: string;
  timezone: string;
  status: string;
  totalCents: number;
  itemCount: number;
  needsAttention: boolean;
  fiscalError: boolean;
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
  customerCpfMasked: string | null;
  fiscal: FiscalView | null;
  items: { productName: string; quantity: number; unitPriceCents: number }[];
  payments: {
    id: string;
    status: string;
    method: string;
    failureReason: string | null;
    provider: string;
    amountCents: number;
    paidAmountCents: number | null;
    createdAt: Date;
  }[];
};

export async function listRecentSales(tx: Tx, limit = 50): Promise<SaleListRow[]> {
  const rows = await tx`
    select s.id, m.name as market_name, m.timezone, s.status, s.total_cents, s.created_at,
      (select coalesce(sum(i.quantity), 0)::int from sale_items i where i.sale_id = s.id) as item_count,
      exists (select 1 from payments p where p.sale_id = s.id and p.status = 'failed' and p.failure_reason is null) as needs_attention,
      exists (select 1 from fiscal_documents f where f.sale_id = s.id and f.status = 'error') as fiscal_error
    from sales s join markets m on m.id = s.market_id
    where exists (select 1 from sale_items i where i.sale_id = s.id)
      or exists (select 1 from payments p where p.sale_id = s.id)
    order by s.created_at desc limit ${limit}`;
  return rows.map((r) => ({
    id: r.id as string,
    marketName: r.market_name as string,
    timezone: r.timezone as string,
    status: r.status as string,
    totalCents: r.total_cents as number,
    itemCount: r.item_count as number,
    needsAttention: r.needs_attention as boolean,
    fiscalError: r.fiscal_error as boolean,
    createdAt: r.created_at as Date,
  }));
}

export async function getSaleDetail(tx: Tx, saleId: string): Promise<SaleDetail | null> {
  if (!z.string().uuid().safeParse(saleId).success) return null;
  const [s] = await tx`
    select s.id, m.name as market_name, m.timezone, s.status, s.total_cents, s.created_at, s.paid_at, s.customer_cpf
    from sales s join markets m on m.id = s.market_id where s.id = ${saleId}`;
  if (!s) return null;
  const items = await tx`
    select product_name, quantity, unit_price_cents from sale_items
    where sale_id = ${saleId} order by product_name, id`;
  const payments = await tx`
    select id, status, method, provider, amount_cents, failure_reason,
      (webhook_payload->>'paidAmountCents')::numeric as paid_amount_cents, created_at
    from payments where sale_id = ${saleId} order by created_at, id`;
  const [f] = await tx`
    select status, attempts, number, access_key, danfe_url, last_error
    from fiscal_documents where sale_id = ${saleId}`;
  return {
    id: s.id as string,
    marketName: s.market_name as string,
    timezone: s.timezone as string,
    status: s.status as string,
    totalCents: s.total_cents as number,
    createdAt: s.created_at as Date,
    paidAt: (s.paid_at as Date | null) ?? null,
    customerCpfMasked: s.customer_cpf ? maskCpf(s.customer_cpf as string) : null,
    fiscal: f
      ? {
          status: f.status as string,
          attempts: f.attempts as number,
          number: (f.number as number | null) ?? null,
          accessKey: (f.access_key as string | null) ?? null,
          danfeUrl: (f.danfe_url as string | null) ?? null,
          lastError: (f.last_error as string | null) ?? null,
        }
      : null,
    items: items.map((i) => ({
      productName: i.product_name as string,
      quantity: i.quantity as number,
      unitPriceCents: i.unit_price_cents as number,
    })),
    payments: payments.map((p) => ({
      id: p.id as string,
      status: p.status as string,
      method: p.method as string,
      failureReason: (p.failure_reason as string | null) ?? null,
      provider: p.provider as string,
      amountCents: p.amount_cents as number,
      paidAmountCents: p.paid_amount_cents == null ? null : Number(p.paid_amount_cents),
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

export async function countFiscalErrors(tx: Tx): Promise<number> {
  const [r] = await tx`select count(*)::int as n from fiscal_documents where status = 'error'`;
  return r.n as number;
}
