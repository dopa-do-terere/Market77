import { z } from "zod";
import type { Tx } from "@/db/tenant";
import { parse } from "@/lib/validate";

const validTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const Market = z.object({
  name: z.string().trim().min(2).max(100),
  address: z.string().trim().max(200).optional(),
  timezone: z.string().trim().refine(validTimeZone, "invalid time zone").default("America/Sao_Paulo"),
  // ponytail: length only, no check digits; add CNPJ checksum in the fiscal phase.
  cnpj: z.string().transform((s) => s.replace(/\D/g, "")).pipe(z.string().length(14)).optional(),
});

export type MarketRow = {
  id: string;
  name: string;
  address: string | null;
  timezone: string;
  cnpj: string | null;
};

export async function createMarket(tx: Tx, orgId: string, raw: unknown): Promise<MarketRow> {
  const m = parse(Market, raw);
  const [row] = await tx`
    insert into markets (org_id, name, address, timezone, cnpj)
    values (${orgId}, ${m.name}, ${m.address ?? null}, ${m.timezone}, ${m.cnpj ?? null})
    returning id, name, address, timezone, cnpj`;
  return row as unknown as MarketRow;
}

export async function listMarkets(tx: Tx): Promise<MarketRow[]> {
  const rows = await tx`select id, name, address, timezone, cnpj from markets order by name`;
  return rows as unknown as MarketRow[];
}
