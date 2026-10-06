import { adminSql } from "@/db/client";
import { withOrg } from "@/db/tenant";
import { createHash, randomUUID } from "node:crypto";
import { AppError } from "@/lib/errors";
import { confirmPayment, startPayment } from "@/domain/payments";
import { addItemByBarcode } from "@/domain/sales";
import { fakeProvider } from "@/payments/fake";

const TABLES = [
  "organization_branding", "access_events", "access_people", "access_sources",
  "terminal_commands", "agent_releases",
  "fiscal_documents", "payments", "sale_items", "sales", "terminals",
  "stock_lots", "stock_movements", "market_products", "product_barcodes", "products",
  "markets", "memberships", "sessions", "users", "provider_credentials", "organizations",
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

/** Turns on expiry control for a market product. */
export async function track(marketProductId: string): Promise<void> {
  await adminSql`update market_products set tracks_expiry = true where id = ${marketProductId}`;
}

/** Creates (or reuses) the lot of this date and, when quantity is not zero, books an entry into it. */
export async function addLot(
  orgId: string,
  marketProductId: string,
  expiresOn: string,
  quantity: number,
): Promise<string> {
  const [l] = await adminSql`
    insert into stock_lots (org_id, market_product_id, expires_on)
    values (${orgId}, ${marketProductId}, ${expiresOn})
    on conflict (market_product_id, expires_on) do update set expires_on = excluded.expires_on
    returning id`;
  if (quantity !== 0) {
    await adminSql`
      insert into stock_movements (org_id, market_product_id, type, quantity, lot_id)
      values (${orgId}, ${marketProductId}, 'in', ${quantity}, ${l.id})`;
  }
  return l.id as string;
}

/** A market and a product with no price or stock, for tests that only need rows to exist. */
export async function seedProductless(orgId: string) {
  return withOrg(orgId, async (tx) => {
    const [m] = await tx`insert into markets (org_id, name) values (${orgId}, 'Loja') returning id`;
    const [p] = await tx`insert into products (org_id, name) values (${orgId}, 'Água') returning id`;
    return { marketId: m.id as string, productId: p.id as string };
  });
}

/** A store with NFC-e on, a valid CNPJ, and one sellable product ("Água", R$ 5,00) with an NCM. */
export async function fiscalShop(orgId: string, o: { enabled?: boolean; ncm?: string | null } = {}) {
  const store = await seedStore(orgId);
  const barcode = "7891000100103";
  const item = await seedSellable(orgId, store.marketId, { barcode, priceCents: 500 });
  await adminSql`
    update markets set nfce_enabled = ${o.enabled ?? true}, cnpj = '12345678000195',
      state_registration = '123456789', uf = 'SP' where id = ${store.marketId}`;
  await adminSql`update products set ncm = ${o.ncm === undefined ? "22021000" : o.ncm} where id = ${item.productId}`;
  return { ...store, ...item, barcode };
}

/** A sale of `units` of the product, paid with a confirmed fake Pix. Returns the sale id. */
export async function paidSale(
  orgId: string,
  store: { terminalId: string; marketId: string },
  barcode: string,
  units: number,
  o: { cpf?: string; now?: Date } = {},
): Promise<string> {
  const now = o.now ?? new Date("2026-10-03T15:00:00Z");
  let sale = await withOrg(orgId, (tx) => addItemByBarcode(tx, orgId, store, { barcode }, now));
  for (let i = 1; i < units; i++) {
    sale = await withOrg(orgId, (tx) => addItemByBarcode(tx, orgId, store, { saleId: sale.id, barcode }, now));
  }
  if (o.cpf) await adminSql`update sales set customer_cpf = ${o.cpf} where id = ${sale.id}`;
  await withOrg(orgId, (tx) => startPayment(tx, orgId, store, sale.id, fakeProvider, now));
  const [p] = await adminSql`select id, amount_cents from payments where sale_id = ${sale.id}`;
  await withOrg(orgId, (tx) => confirmPayment(tx, p.id as string, p.amount_cents as number, { test: true }, now));
  return sale.id;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** A reader (access source) of a market. The plain token is returned so tests can authenticate with it. */
export async function seedAccessSource(
  orgId: string,
  marketId: string,
  o: { name?: string; token?: string; revoked?: boolean } = {},
): Promise<{ id: string; token: string }> {
  const token = o.token ?? randomUUID();
  const [s] = await adminSql`
    insert into access_sources (org_id, market_id, name, token_hash, revoked_at)
    values (${orgId}, ${marketId}, ${o.name ?? "Leitor 1"}, ${sha256(token)}, ${o.revoked ? new Date() : null})
    returning id`;
  return { id: s.id as string, token };
}

export async function seedPerson(
  orgId: string,
  sourceId: string,
  externalId: string,
  name: string,
  o: { active?: boolean; forgotten?: boolean } = {},
): Promise<string> {
  const [p] = await adminSql`
    insert into access_people (org_id, source_id, external_id, name, active, forgotten_at)
    values (${orgId}, ${sourceId}, ${externalId}, ${o.forgotten ? null : name}, ${o.active ?? true},
      ${o.forgotten ? new Date() : null})
    returning id`;
  return p.id as string;
}

export async function seedAccessEvent(
  orgId: string,
  marketId: string,
  sourceId: string,
  o: { at: Date; personId?: string | null; eventId?: string | null },
): Promise<string> {
  const [e] = await adminSql`
    insert into access_events (org_id, market_id, source_id, occurred_at, person_external_id, event_id)
    values (${orgId}, ${marketId}, ${sourceId}, ${o.at}, ${o.personId ?? null}, ${o.eventId ?? null})
    returning id`;
  return e.id as string;
}

export async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (e) {
    return e instanceof AppError ? e.code : "not-app-error";
  }
}
