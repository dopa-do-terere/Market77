import { z } from "zod";
import type { Tx } from "@/db/tenant";
import { AppError, isForeignKeyViolation } from "@/lib/errors";
import { parse } from "@/lib/validate";
import { type Allocation, allocateFefo, getOrCreateLot, isRealDay, lockProducts, todayBR } from "./lots";
import { type MarketProductRow, listMarketProducts } from "./market-products";

const Movement = z
  .object({
    marketProductId: z.string().uuid(),
    type: z.enum(["in", "sale", "loss", "adjustment"]),
    quantity: z.number().int().min(-2147483648).max(2147483647).refine((n) => n !== 0, "quantity must not be zero"),
    note: z.string().trim().max(200).optional(),
    expiresOn: z.string().optional(),
    lotId: z.string().uuid().optional(),
  })
  .superRefine((m, ctx) => {
    if (m.type !== "adjustment" && m.quantity < 0) {
      ctx.addIssue({ code: "custom", path: ["quantity"], message: "quantity must be positive" });
    }
  });

async function insertMovement(
  tx: Tx,
  orgId: string,
  userId: string | null,
  m: { marketProductId: string; type: string; note?: string },
  quantity: number,
  lotId: string | null,
): Promise<string> {
  const [row] = await tx`
    insert into stock_movements (org_id, market_product_id, type, quantity, note, created_by, lot_id)
    values (${orgId}, ${m.marketProductId}, ${m.type}, ${quantity}, ${m.note ?? null}, ${userId}, ${lotId})
    returning id`;
  return row.id as string;
}

/**
 * in/sale/loss take a positive quantity (sign comes from the type);
 * adjustment takes a signed, non-zero quantity. Balance may go negative on purpose:
 * the ledger records what happened, adjustments fix it.
 *
 * A product that tracks expiry books entries into the lot of expiresOn (required, today or later)
 * and removals from lotId, or first-expired-first-out when no lot is given. Other products ignore both.
 */
export async function recordMovement(
  tx: Tx,
  orgId: string,
  userId: string | null,
  raw: unknown,
  now: Date = new Date(),
): Promise<{ id: string; delta: number }> {
  const m = parse(Movement, raw);
  const delta = m.type === "sale" || m.type === "loss" ? -m.quantity : m.quantity;
  try {
    const [mp] = await tx`select tracks_expiry from market_products where id = ${m.marketProductId}`;
    if (!mp) throw new AppError("not_found");
    if (!mp.tracks_expiry) return { id: await insertMovement(tx, orgId, userId, m, delta, null), delta };

    // ponytail: the flag is read before the lock; a flip in that window books this one movement the other way.
    await lockProducts(tx, [m.marketProductId]);
    if (delta > 0) {
      if (!m.expiresOn || !isRealDay(m.expiresOn) || m.expiresOn < todayBR(now)) {
        throw new AppError("invalid_input", "expiresOn must be a real date, today or later");
      }
      const lotId = await getOrCreateLot(tx, orgId, m.marketProductId, m.expiresOn);
      return { id: await insertMovement(tx, orgId, userId, m, delta, lotId), delta };
    }

    let parts: Allocation[];
    if (m.lotId) {
      const [lot] = await tx`select 1 from stock_lots where id = ${m.lotId} and market_product_id = ${m.marketProductId}`;
      if (!lot) throw new AppError("not_found");
      parts = [{ lotId: m.lotId, quantity: -delta }];
    } else {
      parts = await allocateFefo(tx, m.marketProductId, -delta);
    }
    let first = "";
    for (const p of parts) {
      const id = await insertMovement(tx, orgId, userId, m, -p.quantity, p.lotId);
      first ||= id;
    }
    return { id: first, delta };
  } catch (e) {
    if (isForeignKeyViolation(e)) throw new AppError("not_found");
    throw e;
  }
}

export async function getBalance(tx: Tx, marketProductId: string): Promise<number> {
  const [r] = await tx`
    select coalesce(sum(quantity), 0)::bigint as balance
    from stock_movements where market_product_id = ${marketProductId}`;
  return Number(r.balance);
}

export async function listLowStock(tx: Tx, marketId: string): Promise<MarketProductRow[]> {
  return (await listMarketProducts(tx, marketId)).filter((r) => r.active && r.balance <= r.minStock);
}

/**
 * Takes a paid sale out of stock: one movement per product, split by lot (first-expired-first-out)
 * for products that track expiry. The unique index on (sale, product, lot) makes a repeat a no-op error.
 */
export async function debitSale(tx: Tx, saleId: string): Promise<void> {
  const items = await tx`
    select org_id, market_product_id, quantity from sale_items where sale_id = ${saleId} order by market_product_id`;
  if (items.length === 0) return;
  const ids = items.map((i) => i.market_product_id as string);
  const tracked = new Set(
    (await tx`select id from market_products where id in ${tx(ids)} and tracks_expiry`).map((r) => r.id as string),
  );
  await lockProducts(tx, [...tracked]);
  for (const it of items) {
    const mpId = it.market_product_id as string;
    const parts: Allocation[] = tracked.has(mpId)
      ? await allocateFefo(tx, mpId, it.quantity as number)
      : [{ lotId: null, quantity: it.quantity as number }];
    for (const p of parts) {
      await tx`
        insert into stock_movements (org_id, market_product_id, type, quantity, sale_id, lot_id)
        values (${it.org_id}, ${mpId}, 'sale', ${-p.quantity}, ${saleId}, ${p.lotId})`;
    }
  }
}
