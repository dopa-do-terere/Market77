import { adminSql } from "@/db/client";
import { withOrg } from "@/db/tenant";

const TABLES = [
  "stock_movements", "market_products", "product_barcodes", "products",
  "markets", "memberships", "sessions", "users", "organizations",
];

export async function resetDb(): Promise<void> {
  await adminSql.unsafe(`truncate ${TABLES.join(", ")} restart identity cascade`);
}

export async function makeOrg(name = "Org"): Promise<string> {
  const [r] = await adminSql`insert into organizations (name) values (${name}) returning id`;
  return r.id as string;
}

export async function seedMarketProduct(orgId: string, priceCents = 500) {
  return withOrg(orgId, async (tx) => {
    const [m] = await tx`insert into markets (org_id, name) values (${orgId}, 'Loja') returning id`;
    const [p] = await tx`insert into products (org_id, name) values (${orgId}, 'Água') returning id`;
    const [mp] = await tx`
      insert into market_products (org_id, market_id, product_id, price_cents)
      values (${orgId}, ${m.id}, ${p.id}, ${priceCents}) returning id`;
    return {
      marketId: m.id as string,
      productId: p.id as string,
      marketProductId: mp.id as string,
    };
  });
}

export async function makeUser(email: string): Promise<string> {
  const [r] = await adminSql`
    insert into users (email, password_hash) values (${email}, 'x') returning id`;
  return r.id as string;
}
