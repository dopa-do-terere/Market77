import type postgres from "postgres";
import { adminSql } from "@/db/client";
import { type Tx, withOrg } from "@/db/tenant";
import { FiscalRejected, type FiscalPayload, type FiscalProvider } from "@/fiscal/provider";
import { getFiscalProvider } from "@/fiscal/registry";
import { AppError } from "@/lib/errors";
import { normalizeCnpj, normalizeCpf } from "@/lib/tax-id";
import { withTimeout } from "@/payments/provider";

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

export const MAX_ATTEMPTS = 8;

/** 1, 2, 4, 8, 16, 32, 60, 60 minutes after the 1st, 2nd, ... failure. */
export const backoffMinutes = (attempts: number): number => Math.min(2 ** (attempts - 1), 60);

type Invalid = { code: string; message: string };
const bad = (code: string, message: string): Invalid => ({ code, message });

/** The first reason this snapshot cannot be issued, or null. Nothing here can be fixed by retrying. */
export function validatePayload(p: FiscalPayload): Invalid | null {
  if (p.items.length === 0) return bad("empty_sale", "Venda sem itens.");
  if (p.emitter.regime !== "simples") {
    return bad("unsupported_regime", "Só o Simples Nacional emite NFC-e nesta versão.");
  }
  if (!p.emitter.cnpj || !normalizeCnpj(p.emitter.cnpj)) return bad("invalid_cnpj", "CNPJ do mercado inválido.");
  if (!p.emitter.stateRegistration) return bad("missing_state_registration", "Inscrição estadual do mercado ausente.");
  if (!p.emitter.uf) return bad("missing_uf", "UF do mercado ausente.");
  if (p.customer && !normalizeCpf(p.customer.cpf)) return bad("invalid_customer_cpf", "CPF do cliente inválido.");
  const noNcm = p.items.find((i) => !i.ncm);
  if (noNcm) return bad("missing_ncm", `Produto sem NCM: ${noNcm.description}.`);
  return null;
}

async function markError(tx: Tx, id: string, attempts: number, text: string, now: Date): Promise<void> {
  await tx`
    update fiscal_documents set status = 'error', attempts = ${attempts}, last_error = ${text}, updated_at = ${now}
    where id = ${id}`;
}

/**
 * One attempt at one document, under a row lock that other processors skip.
 * ponytail: the provider call runs inside the transaction, like the other providers; the 5 s timeout bounds the lock.
 */
async function processOne(tx: Tx, id: string, provider: FiscalProvider, now: Date): Promise<boolean> {
  const [doc] = await tx`
    select id, attempts, payload from fiscal_documents
    where id = ${id} and status = 'pending' and next_attempt_at <= ${now}
    for update skip locked`;
  if (!doc) return false;
  const attempts = (doc.attempts as number) + 1;
  try {
    const payload = doc.payload as FiscalPayload;
    const invalid = validatePayload(payload);
    if (invalid) {
      await markError(tx, id, attempts, `${invalid.code}: ${invalid.message}`, now);
      return true;
    }
    // Ask first: a lost answer must not turn into a second note.
    const issued = (await withTimeout(provider.getByRef(id))) ?? (await withTimeout(provider.issueNfce(id, payload)));
    await tx`
      update fiscal_documents set status = 'issued', attempts = ${attempts}, provider = ${provider.name},
        external_id = ${issued.externalId}, number = ${issued.number}, access_key = ${issued.accessKey},
        danfe_url = ${issued.danfeUrl}, issued_at = ${now}, last_error = null, updated_at = ${now}
      where id = ${id}`;
  } catch (e) {
    if (e instanceof FiscalRejected) {
      await markError(tx, id, attempts, `${e.code}: ${e.message}`, now);
    } else if (attempts >= MAX_ATTEMPTS) {
      await markError(tx, id, attempts, `unavailable: Provedor fiscal indisponível após ${MAX_ATTEMPTS} tentativas.`, now);
    } else {
      const next = new Date(now.getTime() + backoffMinutes(attempts) * 60_000);
      const why = e instanceof Error ? e.message : String(e);
      await tx`
        update fiscal_documents set attempts = ${attempts}, next_attempt_at = ${next},
          last_error = ${`retry: ${why}`}, updated_at = ${now}
        where id = ${id}`;
    }
  }
  return true;
}

/** Issues every pending document that is due. Meant for POST /api/internal/reconcile, once a minute. */
export async function processFiscalQueue(
  now: Date = new Date(),
  limit = 50,
  provider?: FiscalProvider,
): Promise<number> {
  const due = await adminSql`
    select id, org_id from fiscal_documents
    where status = 'pending' and next_attempt_at <= ${now} order by next_attempt_at limit ${limit}`;
  if (due.length === 0) return 0;
  const p = provider ?? getFiscalProvider();
  let done = 0;
  for (const d of due) {
    try {
      if (await withOrg(d.org_id as string, (tx) => processOne(tx, d.id as string, p, now))) done++;
    } catch (e) {
      console.error("fiscal document failed", d.id, e); // one bad document must not stop the queue
    }
  }
  return done;
}

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Queues a document with an error again, with a fresh snapshot of today's registration. */
export async function reissueFiscalDocument(tx: Tx, saleId: string, now: Date): Promise<void> {
  if (!uuidRe.test(saleId)) throw new AppError("not_found");
  const [doc] = await tx`select id, status from fiscal_documents where sale_id = ${saleId} for update`;
  if (!doc) throw new AppError("not_found");
  if (doc.status !== "error") throw new AppError("invalid_input", "only documents with an error can be reissued");
  const { payload } = await buildPayload(tx, saleId);
  await tx`
    update fiscal_documents set status = 'pending', attempts = 0, last_error = null, next_attempt_at = ${now},
      payload = ${tx.json(payload as unknown as postgres.JSONValue)}, updated_at = ${now}
    where id = ${doc.id}`;
}
