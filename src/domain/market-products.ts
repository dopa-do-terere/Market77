import { z } from "zod";
import type { Tx } from "@/db/tenant";
import { AppError, isForeignKeyViolation, isInsufficientPrivilege } from "@/lib/errors";
import { parse } from "@/lib/validate";

const Input = z.object({
  marketId: z.string().uuid(),
  productId: z.string().uuid(),
  priceCents: z.number().int().min(1).max(2147483647),
  minStock: z.number().int().min(0).max(2147483647).default(0),
  active: z.boolean().default(true),
  tracksExpiry: z.boolean().optional(),
});

export type MarketProductRow = {
  id: string;
  productId: string;
  name: string;
  priceCents: number;
  minStock: number;
  active: boolean;
  tracksExpiry: boolean;
  balance: number;
};

export async function setMarketProduct(tx: Tx, orgId: string, raw: unknown): Promise<{ id: string }> {
  const i = parse(Input, raw);
  try {
    const [row] = await tx`
      insert into market_products (org_id, market_id, product_id, price_cents, min_stock, active, tracks_expiry)
      values (${orgId}, ${i.marketId}, ${i.productId}, ${i.priceCents}, ${i.minStock}, ${i.active}, ${i.tracksExpiry ?? false})
      on conflict (market_id, product_id) do update
        set price_cents = excluded.price_cents, min_stock = excluded.min_stock, active = excluded.active,
            tracks_expiry = coalesce(${i.tracksExpiry ?? null}::boolean, market_products.tracks_expiry)
      returning id`;
    return { id: row.id as string };
  } catch (e) {
    if (isForeignKeyViolation(e) || isInsufficientPrivilege(e)) throw new AppError("not_found");
    throw e;
  }
}

export async function listMarketProducts(tx: Tx, marketId: string): Promise<MarketProductRow[]> {
  const rows = await tx`
    select mp.id, mp.product_id, p.name, mp.price_cents, mp.min_stock, mp.active, mp.tracks_expiry,
      coalesce((select sum(s.quantity) from stock_movements s where s.market_product_id = mp.id), 0)::bigint as balance
    from market_products mp join products p on p.id = mp.product_id
    where mp.market_id = ${marketId} order by p.name`;
  return rows.map((r) => ({
    id: r.id as string,
    productId: r.product_id as string,
    name: r.name as string,
    priceCents: r.price_cents as number,
    minStock: r.min_stock as number,
    active: r.active as boolean,
    tracksExpiry: r.tracks_expiry as boolean,
    balance: Number(r.balance),
  }));
}
