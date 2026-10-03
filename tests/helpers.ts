import { adminSql } from "@/db/client";
import { withOrg } from "@/db/tenant";
import { randomUUID } from "node:crypto";
import { AppError } from "@/lib/errors";

const TABLES = [
  "terminal_commands", "agent_releases",
  "payments", "sale_items", "sales", "terminals",
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

export async function seedStore(orgId: string) {
  return withOrg(orgId, async (tx) => {
    const [m] = await tx`insert into markets (org_id, name) values (${orgId}, 'Loja') returning id`;
    const [t] = await tx`
      insert into terminals (org_id, market_id, name, token_hash)
      values (${orgId}, ${m.id}, 'Totem', ${randomUUID()}) returning id`;
    return { marketId: m.id as string, terminalId: t.id as string };
  });
}

export async function seedSellable(
  orgId: string,
  marketId: string,
  o: { barcode?: string; priceCents?: number; name?: string; active?: boolean } = {},
) {
  return withOrg(orgId, async (tx) => {
    const [p] = await tx`insert into products (org_id, name) values (${orgId}, ${o.name ?? "Água"}) returning id`;
    if (o.barcode) {
      await tx`insert into product_barcodes (org_id, product_id, code) values (${orgId}, ${p.id}, ${o.barcode})`;
    }
    const [mp] = await tx`
      insert into market_products (org_id, market_id, product_id, price_cents, active)
      values (${orgId}, ${marketId}, ${p.id}, ${o.priceCents ?? 500}, ${o.active ?? true}) returning id`;
    return { productId: p.id as string, marketProductId: mp.id as string };
  });
}

export async function seedSale(orgId: string) {
  const store = await seedStore(orgId);
  const saleId = await withOrg(orgId, async (tx) => {
    const [s] = await tx`
      insert into sales (org_id, market_id, terminal_id, expires_at)
      values (${orgId}, ${store.marketId}, ${store.terminalId}, now() + interval '5 minutes') returning id`;
    return s.id as string;
  });
  return { ...store, saleId };
}

export async function seedPayment(
  orgId: string,
  saleId: string,
  o: {
    externalId?: string;
    status?: string;
    provider?: string;
    amountCents?: number;
    method?: "pix" | "card";
    failureReason?: string;
  } = {},
) {
  const method = o.method ?? "pix";
  return withOrg(orgId, async (tx) => {
    const [p] = await tx`
      insert into payments (org_id, sale_id, method, provider, external_id, status, amount_cents, qr_payload, expires_at, failure_reason)
      values (${orgId}, ${saleId}, ${method}, ${o.provider ?? "fake"}, ${o.externalId ?? randomUUID()},
        ${o.status ?? "pending"}, ${o.amountCents ?? 1000}, ${method === "pix" ? "qr" : null},
        now() + interval '3 minutes', ${o.failureReason ?? null})
      returning id`;
    return p.id as string;
  });
}

export async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (e) {
    return e instanceof AppError ? e.code : "not-app-error";
  }
}
