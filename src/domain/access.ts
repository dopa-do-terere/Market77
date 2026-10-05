import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { SourceAuth } from "@/access/auth";
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

export const MAX_FUTURE_MS = 5 * 60_000;
export const MAX_PAST_MS = 7 * 86_400_000;

// Postgres refuses NUL in text (22021): reject it as bad input instead of a 500.
const NO_NUL = /^[^\u0000]*$/;

// zod drops unknown keys: nothing but these four fields is ever stored.
const EventInput = z.object({
  occurredAt: z.string().datetime({ offset: true }),
  eventId: z.string().min(1).max(64).regex(NO_NUL).optional(),
  personId: z.string().min(1).max(64).regex(NO_NUL).optional(),
  kind: z.literal("entry").optional(),
});

/** Stores one entry. A repeated event id of the same reader is a duplicate and writes nothing. */
export async function recordAccessEvent(
  tx: Tx,
  auth: SourceAuth,
  raw: unknown,
  now: Date,
): Promise<{ id: string | null; duplicate: boolean }> {
  const e = parse(EventInput, raw);
  const at = new Date(e.occurredAt);
  if (at.getTime() > now.getTime() + MAX_FUTURE_MS || at.getTime() < now.getTime() - MAX_PAST_MS) {
    throw new AppError("invalid_input", "occurredAt out of range");
  }
  let personId = e.personId ?? null;
  if (personId) {
    const [forgotten] = await tx`
      select 1 from access_people
      where source_id = ${auth.sourceId} and external_id = ${personId} and forgotten_at is not null`;
    if (forgotten) personId = null; // she asked to be forgotten: no identifier is kept
  }
  const [row] = await tx`
    insert into access_events (org_id, market_id, source_id, occurred_at, person_external_id, event_id)
    values (${auth.orgId}, ${auth.marketId}, ${auth.sourceId}, ${at}, ${personId}, ${e.eventId ?? null})
    on conflict (source_id, event_id) where event_id is not null do nothing
    returning id`;
  if (!row) return { id: null, duplicate: true };
  await tx`update access_sources set last_event_at = ${now} where id = ${auth.sourceId}`;
  return { id: row.id as string, duplicate: false };
}
