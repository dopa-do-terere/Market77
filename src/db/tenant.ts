import type { TransactionSql } from "postgres";
import { appSql } from "./client";

export type Tx = TransactionSql;

/**
 * Runs fn in a transaction scoped to one organization. RLS policies read
 * app.org_id, so every query inside fn only sees (and writes) that tenant.
 */
export async function withOrg<T>(orgId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const result = await appSql.begin(async (tx) => {
    await tx`select set_config('app.org_id', ${orgId}, true)`;
    return fn(tx);
  });
  return result as unknown as T;
}
