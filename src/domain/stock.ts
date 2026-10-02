import { z } from "zod";
import type { Tx } from "@/db/tenant";
import { AppError, isForeignKeyViolation } from "@/lib/errors";
import { parse } from "@/lib/validate";
import { type MarketProductRow, listMarketProducts } from "./market-products";

const Movement = z
  .object({
    marketProductId: z.string().uuid(),
    type: z.enum(["in", "sale", "loss", "adjustment"]),
    quantity: z.number().int().min(-2147483648).max(2147483647).refine((n) => n !== 0, "quantity must not be zero"),
    note: z.string().trim().max(200).optional(),
  })
  .superRefine((m, ctx) => {
    if (m.type !== "adjustment" && m.quantity < 0) {
      ctx.addIssue({ code: "custom", path: ["quantity"], message: "quantity must be positive" });
    }
  });

/**
 * in/sale/loss take a positive quantity (sign comes from the type);
 * adjustment takes a signed, non-zero quantity. Balance may go negative on purpose:
 * the ledger records what happened, adjustments fix it.
 */
export async function recordMovement(
  tx: Tx,
  orgId: string,
  userId: string | null,
  raw: unknown,
): Promise<{ id: string; delta: number }> {
  const m = parse(Movement, raw);
  const delta = m.type === "sale" || m.type === "loss" ? -m.quantity : m.quantity;
  try {
    const [row] = await tx`
      insert into stock_movements (org_id, market_product_id, type, quantity, note, created_by)
      values (${orgId}, ${m.marketProductId}, ${m.type}, ${delta}, ${m.note ?? null}, ${userId})
      returning id`;
    return { id: row.id as string, delta };
  } catch (e) {
    if (isForeignKeyViolation(e)) throw new AppError("not_found");
    throw e;
  }
}

export async function getBalance(tx: Tx, marketProductId: string): Promise<number> {
  const [r] = await tx`
    select coalesce(sum(quantity), 0)::int as balance
    from stock_movements where market_product_id = ${marketProductId}`;
  return r.balance as number;
}

export async function listLowStock(tx: Tx, marketId: string): Promise<MarketProductRow[]> {
  return (await listMarketProducts(tx, marketId)).filter((r) => r.active && r.balance <= r.minStock);
}
