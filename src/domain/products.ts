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

export type ProductRow = {
  id: string;
  name: string;
  category: string | null;
  barcodes: string[];
  ncm: string | null;
  cest: string | null;
  cfop: string;
  csosn: string;
  unit: string;
  origin: number;
};

const ProductFiscal = z.object({
  ncm: z.string().regex(/^\d{8}$/, "ncm has 8 digits").optional(),
  cest: z.string().regex(/^\d{7}$/, "cest has 7 digits").optional(),
  cfop: z.string().regex(/^\d{4}$/, "cfop has 4 digits").optional(),
  csosn: z.string().regex(/^\d{3}$/, "csosn has 3 digits").optional(),
  unit: z.string().trim().min(1).max(6).optional(),
  origin: z.number().int().min(0).max(8).optional(),
});

export async function createProduct(tx: Tx, orgId: string, raw: unknown): Promise<ProductRow> {
  const p = parse(Product, raw);
  const [row] = await tx`
    insert into products (org_id, name, category)
    values (${orgId}, ${p.name}, ${p.category ?? null})
    returning id, name, category, ncm, cest, cfop, csosn, unit, origin`;
  for (const code of p.barcodes) {
    try {
      await tx`insert into product_barcodes (org_id, product_id, code) values (${orgId}, ${row.id}, ${code})`;
    } catch (e) {
      if (isUniqueViolation(e)) throw new AppError("barcode_taken", code);
      throw e;
    }
  }
  return {
    id: row.id as string, name: row.name as string, category: row.category as string | null, barcodes: p.barcodes,
    ncm: row.ncm as string | null, cest: row.cest as string | null, cfop: row.cfop as string, csosn: row.csosn as string, unit: row.unit as string, origin: row.origin as number,
  };
}

export async function listProducts(tx: Tx): Promise<ProductRow[]> {
  const rows = await tx`
    select p.id, p.name, p.category, p.ncm, p.cest, p.cfop, p.csosn, p.unit, p.origin,
      coalesce(array_agg(b.code order by b.code) filter (where b.code is not null), '{}') as barcodes
    from products p left join product_barcodes b on b.product_id = p.id
    group by p.id order by p.name`;
  return rows as unknown as ProductRow[];
}

const uuid = z.string().uuid();

/** Saves the fiscal data of a product. Omitted fields keep their value. */
export async function updateProductFiscal(tx: Tx, productId: string, raw: unknown): Promise<void> {
  const f = parse(ProductFiscal, raw);
  if (!uuid.safeParse(productId).success) throw new AppError("not_found");
  const rows = await tx`
    update products set
      ncm = coalesce(${f.ncm ?? null}::text, ncm),
      cest = coalesce(${f.cest ?? null}::text, cest),
      cfop = coalesce(${f.cfop ?? null}::text, cfop),
      csosn = coalesce(${f.csosn ?? null}::text, csosn),
      unit = coalesce(${f.unit ?? null}::text, unit),
      origin = coalesce(${f.origin ?? null}::smallint, origin)
    where id = ${productId} returning id`;
  if (rows.length === 0) throw new AppError("not_found");
}
