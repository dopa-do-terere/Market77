import { adminSql } from "@/db/client";
import { hashTerminalToken } from "@/domain/terminals";
import { AppError } from "@/lib/errors";

export type TerminalAuth = { terminalId: string; orgId: string; marketId: string };

/**
 * Resolves "Authorization: Bearer <token>" to a terminal. This runs before any tenant is known,
 * so it uses adminSql, like the session lookup; everything after it goes through withOrg().
 */
export async function requireTerminal(req: Request): Promise<TerminalAuth> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) throw new AppError("unauthorized");
  const [row] = await adminSql`
    select id, org_id, market_id, revoked_at from terminals where token_hash = ${hashTerminalToken(token)}`;
  if (!row) throw new AppError("unauthorized");
  if (row.revoked_at) throw new AppError("terminal_revoked");
  return { terminalId: row.id as string, orgId: row.org_id as string, marketId: row.market_id as string };
}
