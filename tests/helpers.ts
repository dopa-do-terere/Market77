import { adminSql } from "@/db/client";

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
