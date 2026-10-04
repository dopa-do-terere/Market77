import type { Tx } from "@/db/tenant";

export const EXPIRY_WARN_DAYS = 7;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Civil date (YYYY-MM-DD) in Sao Paulo; en-CA formats in ISO order. */
export function todayBR(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function plusDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function isRealDay(day: string): boolean {
  if (!DAY.test(day)) return false;
  const d = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === day;
}

/** 2026-10-03 -> 03/10/2026 */
export function formatDay(day: string): string {
  return day.split("-").reverse().join("/");
}

export type LotBalance = { id: string; expiresOn: string; balance: number };
export type Allocation = { lotId: string | null; quantity: number };

/**
 * First-expired-first-out: lots arrive ordered by expiry. Whatever the lots cannot cover goes to
 * no lot, which is also where the old unlotted balance lives, so one bucket covers both.
 */
export function planFefo(lots: LotBalance[], quantity: number): Allocation[] {
  const out: Allocation[] = [];
  let left = quantity;
  for (const l of lots) {
    if (left === 0) break;
    if (l.balance <= 0) continue;
    const take = Math.min(l.balance, left);
    out.push({ lotId: l.id, quantity: take });
    left -= take;
  }
  if (left > 0) out.push({ lotId: null, quantity: left });
  return out;
}

export async function getOrCreateLot(
  tx: Tx,
  orgId: string,
  marketProductId: string,
  expiresOn: string,
): Promise<string> {
  await tx`
    insert into stock_lots (org_id, market_product_id, expires_on)
    values (${orgId}, ${marketProductId}, ${expiresOn})
    on conflict (market_product_id, expires_on) do nothing`;
  const [l] = await tx`
    select id from stock_lots where market_product_id = ${marketProductId} and expires_on = ${expiresOn}`;
  return l.id as string;
}

export async function listLotBalances(tx: Tx, marketProductId: string): Promise<LotBalance[]> {
  const rows = await tx`
    select l.id, l.expires_on::text as expires_on, coalesce(sum(s.quantity), 0)::bigint as balance
    from stock_lots l left join stock_movements s on s.lot_id = l.id
    where l.market_product_id = ${marketProductId}
    group by l.id, l.expires_on, l.received_at
    order by l.expires_on, l.received_at`;
  return rows.map((r) => ({ id: r.id as string, expiresOn: r.expires_on as string, balance: Number(r.balance) }));
}

export async function allocateFefo(tx: Tx, marketProductId: string, quantity: number): Promise<Allocation[]> {
  return planFefo(await listLotBalances(tx, marketProductId), quantity);
}

/**
 * Serializes work on the stock of these products. Callers lock in this one order (sale, payment,
 * then products by id) so two confirmations never read the same lot balance or deadlock.
 * Uses FOR NO KEY UPDATE so it still excludes other lockers but not the KEY SHARE of foreign-key checks (scans on other totems).
 */
export async function lockProducts(tx: Tx, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await tx`select id from market_products where id in ${tx(ids)} order by id for no key update`;
}

/** True when the product has stock in expired lots and nothing valid left (lots not expired, or no lot). */
export async function isFullyExpired(tx: Tx, marketProductId: string, today: string): Promise<boolean> {
  const [r] = await tx`
    select
      coalesce(sum(s.quantity) filter (where l.id is not null and l.expires_on < ${today}), 0)::bigint as expired,
      coalesce(sum(s.quantity) filter (where l.id is null or l.expires_on >= ${today}), 0)::bigint as valid
    from stock_movements s left join stock_lots l on l.id = s.lot_id
    where s.market_product_id = ${marketProductId}`;
  return Number(r.expired) > 0 && Number(r.valid) <= 0;
}

export type ExpiryAlert = {
  lotId: string;
  marketProductId: string;
  productName: string;
  expiresOn: string;
  quantity: number;
  status: "expired" | "expiring";
};

/** Lots with stock that already expired or expire within EXPIRY_WARN_DAYS, earliest first. */
export async function listExpiryAlerts(tx: Tx, marketId: string, now: Date): Promise<ExpiryAlert[]> {
  const today = todayBR(now);
  const limit = plusDays(today, EXPIRY_WARN_DAYS);
  const rows = await tx`
    select l.id, l.market_product_id, p.name, l.expires_on::text as expires_on, sum(s.quantity)::bigint as quantity
    from stock_lots l
    join market_products mp on mp.id = l.market_product_id
    join products p on p.id = mp.product_id
    join stock_movements s on s.lot_id = l.id
    where mp.market_id = ${marketId} and mp.tracks_expiry and l.expires_on <= ${limit}
    group by l.id, l.market_product_id, p.name, l.expires_on
    having sum(s.quantity) > 0
    order by l.expires_on, p.name`;
  return rows.map((r) => ({
    lotId: r.id as string,
    marketProductId: r.market_product_id as string,
    productName: r.name as string,
    expiresOn: r.expires_on as string,
    quantity: Number(r.quantity),
    status: (r.expires_on as string) < today ? "expired" : "expiring",
  }));
}
