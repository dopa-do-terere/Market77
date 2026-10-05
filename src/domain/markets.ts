import { z } from "zod";
import type { Tx } from "@/db/tenant";
import { AppError } from "@/lib/errors";
import { normalizeCnpj } from "@/lib/tax-id";
import { parse } from "@/lib/validate";

const validTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const cnpj = z
  .string()
  .refine((s) => normalizeCnpj(s) !== null, "invalid cnpj")
  .transform((s) => normalizeCnpj(s) as string);

const Market = z.object({
  name: z.string().trim().min(2).max(100),
  address: z.string().trim().max(200).optional(),
  timezone: z.string().trim().refine(validTimeZone, "invalid time zone").default("America/Sao_Paulo"),
  cnpj: cnpj.optional(),
});

export const UFS = [
  "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA", "PB", "PE", "PI", "PR",
  "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO",
] as const;

const MarketFiscal = z.object({
  nfceEnabled: z.boolean(),
  cnpj: cnpj.optional(),
  stateRegistration: z.string().trim().min(1).max(20).optional(),
  uf: z.enum(UFS).optional(),
  taxRegime: z.enum(["simples", "normal"]).optional(),
  nfceSeries: z.number().int().min(1).max(999).optional(),
});

export type MarketRow = {
  id: string;
  name: string;
  address: string | null;
  timezone: string;
  cnpj: string | null;
  nfceEnabled: boolean;
  stateRegistration: string | null;
  uf: string | null;
  taxRegime: string;
  nfceSeries: number;
};

const toRow = (r: Record<string, unknown>): MarketRow => ({
  id: r.id as string,
  name: r.name as string,
  address: (r.address as string | null) ?? null,
  timezone: r.timezone as string,
  cnpj: (r.cnpj as string | null) ?? null,
  nfceEnabled: r.nfce_enabled as boolean,
  stateRegistration: (r.state_registration as string | null) ?? null,
  uf: (r.uf as string | null) ?? null,
  taxRegime: r.tax_regime as string,
  nfceSeries: r.nfce_series as number,
});

export async function createMarket(tx: Tx, orgId: string, raw: unknown): Promise<MarketRow> {
  const m = parse(Market, raw);
  const [row] = await tx`
    insert into markets (org_id, name, address, timezone, cnpj)
    values (${orgId}, ${m.name}, ${m.address ?? null}, ${m.timezone}, ${m.cnpj ?? null})
    returning id, name, address, timezone, cnpj, nfce_enabled, state_registration, uf, tax_regime, nfce_series`;
  return toRow(row);
}

export async function listMarkets(tx: Tx): Promise<MarketRow[]> {
  const rows = await tx`
    select id, name, address, timezone, cnpj, nfce_enabled, state_registration, uf, tax_regime, nfce_series
    from markets order by name`;
  return rows.map(toRow);
}

const uuid = z.string().uuid();

/** Saves the NFC-e registration of a market. Omitted fields keep their value. */
export async function updateMarketFiscal(tx: Tx, marketId: string, raw: unknown): Promise<void> {
  const f = parse(MarketFiscal, raw);
  if (!uuid.safeParse(marketId).success) throw new AppError("not_found");
  const rows = await tx`
    update markets set
      nfce_enabled = ${f.nfceEnabled},
      cnpj = coalesce(${f.cnpj ?? null}::text, cnpj),
      state_registration = coalesce(${f.stateRegistration ?? null}::text, state_registration),
      uf = coalesce(${f.uf ?? null}::text, uf),
      tax_regime = coalesce(${f.taxRegime ?? null}::text, tax_regime),
      nfce_series = coalesce(${f.nfceSeries ?? null}::integer, nfce_series)
    where id = ${marketId} returning id`;
  if (rows.length === 0) throw new AppError("not_found");
}
