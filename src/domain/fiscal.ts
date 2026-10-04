import type postgres from "postgres";
import type { Tx } from "@/db/tenant";
import type { FiscalPayload } from "@/fiscal/provider";
import { AppError } from "@/lib/errors";

type Built = { orgId: string; marketId: string; enabled: boolean; payload: FiscalPayload };

/** The fiscal snapshot of a sale: emitter, customer and items as they are right now. */
export async function buildPayload(tx: Tx, saleId: string): Promise<Built> {
  const [s] = await tx`
    select s.org_id, s.market_id, s.total_cents, s.paid_at, s.customer_cpf,
      m.nfce_enabled, m.cnpj, m.state_registration, m.uf, m.tax_regime, m.nfce_series
    from sales s join markets m on m.id = s.market_id where s.id = ${saleId}`;
  if (!s) throw new AppError("sale_not_found");
  const items = await tx`
    select si.product_name, si.quantity, si.unit_price_cents, p.ncm, p.cest, p.cfop, p.csosn, p.unit, p.origin
    from sale_items si
    join market_products mp on mp.id = si.market_product_id
    join products p on p.id = mp.product_id
    where si.sale_id = ${saleId} order by si.product_name, si.id`;
  const [pay] = await tx`
    select method from payments where sale_id = ${saleId} and status = 'confirmed' order by created_at desc limit 1`;
  const payload: FiscalPayload = {
    emitter: {
      cnpj: (s.cnpj as string | null) ?? null,
      stateRegistration: (s.state_registration as string | null) ?? null,
      uf: (s.uf as string | null) ?? null,
      series: s.nfce_series as number,
      regime: s.tax_regime as string,
    },
    customer: s.customer_cpf ? { cpf: s.customer_cpf as string } : null,
    items: items.map((i) => ({
      description: i.product_name as string,
      ncm: (i.ncm as string | null) ?? null,
      cest: (i.cest as string | null) ?? null,
      cfop: i.cfop as string,
      csosn: i.csosn as string,
      unit: i.unit as string,
      origin: i.origin as number,
      quantity: i.quantity as number,
      unitPriceCents: i.unit_price_cents as number,
      totalCents: (i.quantity as number) * (i.unit_price_cents as number),
    })),
    totalCents: s.total_cents as number,
    paymentMethod: (pay?.method as string | undefined) ?? "pix",
    paidAt: (s.paid_at as Date).toISOString(),
  };
  return { orgId: s.org_id as string, marketId: s.market_id as string, enabled: s.nfce_enabled as boolean, payload };
}

/**
 * Queues the fiscal document of a paid sale (when the market issues NFC-e). Runs inside a savepoint
 * and swallows every error: a payment that is already confirmed must never fail because of the invoice.
 */
export async function enqueueFiscalDocument(
  tx: Tx,
  saleId: string,
  now: Date,
  build: (tx: Tx, saleId: string) => Promise<Built> = buildPayload,
): Promise<void> {
  try {
    await tx.savepoint(async (sp) => {
      const b = await build(sp, saleId);
      if (!b.enabled) return;
      await sp`
        insert into fiscal_documents (org_id, sale_id, market_id, payload, next_attempt_at, updated_at)
        values (${b.orgId}, ${saleId}, ${b.marketId}, ${sp.json(b.payload as unknown as postgres.JSONValue)}, ${now}, ${now})
        on conflict (sale_id) do nothing`;
    });
  } catch (e) {
    console.error("fiscal enqueue failed for sale", saleId, e);
  }
}
