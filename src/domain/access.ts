import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { Tx } from "@/db/tenant";
import { AppError, isForeignKeyViolation, isInsufficientPrivilege } from "@/lib/errors";
import { parse } from "@/lib/validate";

export const hashAccessToken = (token: string): string => createHash("sha256").update(token).digest("hex");

const SourceInput = z.object({ marketId: z.string().uuid(), name: z.string().trim().min(2).max(60) });

/** The plain token is returned once and never stored: only its SHA-256 is. */
export async function createAccessSource(
  tx: Tx,
  orgId: string,
  raw: unknown,
): Promise<{ id: string; token: string }> {
  const i = parse(SourceInput, raw);
  const token = randomBytes(32).toString("base64url");
  try {
    const [row] = await tx`
      insert into access_sources (org_id, market_id, name, token_hash)
      values (${orgId}, ${i.marketId}, ${i.name}, ${hashAccessToken(token)})
      returning id`;
    return { id: row.id as string, token };
  } catch (e) {
    if (isForeignKeyViolation(e) || isInsufficientPrivilege(e)) throw new AppError("not_found");
    throw e;
  }
}

const uuid = z.string().uuid();

export async function revokeAccessSource(tx: Tx, sourceId: string): Promise<void> {
  if (!uuid.safeParse(sourceId).success) throw new AppError("not_found");
  const rows = await tx`
    update access_sources set revoked_at = coalesce(revoked_at, now()) where id = ${sourceId} returning id`;
  if (rows.length === 0) throw new AppError("not_found");
}
