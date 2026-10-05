import { adminSql } from "@/db/client";
import { hashAccessToken } from "@/domain/access";
import { AppError } from "@/lib/errors";

export type SourceAuth = { sourceId: string; orgId: string; marketId: string };

/**
 * Resolves "Authorization: Bearer <token>" to a reader. This runs before any tenant is known,
 * so it uses adminSql, like the terminal lookup; everything after it goes through withOrg().
 */
export async function requireSource(req: Request): Promise<SourceAuth> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) throw new AppError("unauthorized");
  const [row] = await adminSql`
    select id, org_id, market_id, revoked_at from access_sources where token_hash = ${hashAccessToken(token)}`;
  if (!row) throw new AppError("unauthorized");
  if (row.revoked_at) throw new AppError("source_revoked");
  return { sourceId: row.id as string, orgId: row.org_id as string, marketId: row.market_id as string };
}
