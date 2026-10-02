import { z } from "zod";
import type { Tx } from "@/db/tenant";
import { AppError, isUniqueViolation } from "@/lib/errors";
import { parse } from "@/lib/validate";

const barcode = z.string().trim().regex(/^[0-9A-Za-z-]{4,32}$/, "invalid barcode");

const Product = z.object({
  name: z.string().trim().min(2).max(150),
  category: z.string().trim().max(60).optional(),
  barcodes: z.array(barcode).max(10).default([]).transform((a) => [...new Set(a)]),
});

export type ProductRow = { id: string; name: string; category: string | null; barcodes: string[] };

export async function createProduct(tx: Tx, orgId: string, raw: unknown): Promise<ProductRow> {
  const p = parse(Product, raw);
  const [row] = await tx`
    insert into products (org_id, name, category)
    values (${orgId}, ${p.name}, ${p.category ?? null}) returning id, name, category`;
  for (const code of p.barcodes) {
    try {
      await tx`insert into product_barcodes (org_id, product_id, code) values (${orgId}, ${row.id}, ${code})`;
    } catch (e) {
      if (isUniqueViolation(e)) throw new AppError("barcode_taken", code);
      throw e;
    }
  }
  return { id: row.id as string, name: row.name as string, category: row.category as string | null, barcodes: p.barcodes };
}

export async function listProducts(tx: Tx): Promise<ProductRow[]> {
  const rows = await tx`
    select p.id, p.name, p.category,
      coalesce(array_agg(b.code order by b.code) filter (where b.code is not null), '{}') as barcodes
    from products p left join product_barcodes b on b.product_id = p.id
    group by p.id order by p.name`;
  return rows as unknown as ProductRow[];
}
