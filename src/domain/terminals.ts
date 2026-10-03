import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { Tx } from "@/db/tenant";
import { AppError, isForeignKeyViolation, isInsufficientPrivilege } from "@/lib/errors";
import { parse } from "@/lib/validate";

export const hashTerminalToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

const Input = z.object({ marketId: z.string().uuid(), name: z.string().trim().min(2).max(60) });

export type TerminalRow = {
  id: string;
  marketId: string;
  marketName: string;
  timezone: string;
  name: string;
  createdAt: Date;
  revokedAt: Date | null;
  lastHeartbeatAt: Date | null;
  agentVersion: string | null;
  pdvStatus: string | null;
};

/** The plain token is returned once and never stored: only its SHA-256 is. */
export async function createTerminal(
  tx: Tx,
  orgId: string,
  raw: unknown,
): Promise<{ id: string; token: string }> {
  const i = parse(Input, raw);
  const token = randomBytes(32).toString("base64url");
  try {
    const [row] = await tx`
      insert into terminals (org_id, market_id, name, token_hash)
      values (${orgId}, ${i.marketId}, ${i.name}, ${hashTerminalToken(token)})
      returning id`;
    return { id: row.id as string, token };
  } catch (e) {
    if (isForeignKeyViolation(e) || isInsufficientPrivilege(e)) throw new AppError("not_found");
    throw e;
  }
}

export async function listTerminals(tx: Tx): Promise<TerminalRow[]> {
  const rows = await tx`
    select t.id, t.market_id, m.name as market_name, m.timezone, t.name, t.created_at, t.revoked_at,
           t.last_heartbeat_at, t.agent_version, t.pdv_status
    from terminals t join markets m on m.id = t.market_id
    order by t.created_at desc`;
  return rows.map((r) => ({
    id: r.id as string,
    marketId: r.market_id as string,
    marketName: r.market_name as string,
    timezone: r.timezone as string,
    name: r.name as string,
    createdAt: r.created_at as Date,
    revokedAt: (r.revoked_at as Date | null) ?? null,
    lastHeartbeatAt: (r.last_heartbeat_at as Date | null) ?? null,
    agentVersion: (r.agent_version as string | null) ?? null,
    pdvStatus: (r.pdv_status as string | null) ?? null,
  }));
}

export async function revokeTerminal(tx: Tx, terminalId: string): Promise<void> {
  if (!z.string().uuid().safeParse(terminalId).success) throw new AppError("not_found");
  const rows = await tx`
    update terminals set revoked_at = coalesce(revoked_at, now()) where id = ${terminalId} returning id`;
  if (rows.length === 0) throw new AppError("not_found");
}
