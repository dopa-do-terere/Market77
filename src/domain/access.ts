import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { SourceAuth } from "@/access/auth";
import type { AccessProvider } from "@/access/provider";
import { getAccessProvider } from "@/access/registry";
import { adminSql } from "@/db/client";
import { type Tx, withOrg } from "@/db/tenant";
import { AppError, isForeignKeyViolation, isInsufficientPrivilege } from "@/lib/errors";
import { parse } from "@/lib/validate";
import { withTimeout } from "@/payments/provider";

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

export const SYNC_INTERVAL_MS = 10 * 60_000;
const CHUNK = 500;

// Postgres refuses NUL and a lone surrogate cannot be encoded: such an entry would fail the write on every run.
const storable = (s: string) => !/\u0000|\p{Cs}/u.test(s);
const Person = z.object({
  externalId: z.string().trim().min(1).max(64).refine(storable),
  name: z.string().trim().min(1).max(120).refine(storable),
});

/** Valid entries only; the first of a repeated id wins. */
function cleanPeople(listed: unknown): { externalId: string; name: string }[] {
  if (!Array.isArray(listed)) throw new Error("no valid people in the reader answer");
  const seen = new Map<string, { externalId: string; name: string }>();
  for (const p of listed) {
    const r = Person.safeParse(p);
    if (r.success && !seen.has(r.data.externalId)) seen.set(r.data.externalId, r.data);
  }
  // A non-empty answer with nothing usable is a broken reader, not an empty one: keep the old list.
  if (listed.length > 0 && seen.size === 0) throw new Error("no valid people in the reader answer");
  return [...seen.values()];
}

/** Error text kept on the source: never SQL text (it may carry names or ids), no NUL, at most 200 chars. */
function errorText(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  if (typeof code === "string") return `sql error ${code}`;
  const msg = e instanceof Error ? e.message : String(e);
  return msg.replace(/\u0000/g, "").slice(0, 200);
}

/**
 * One sync of one reader, under a row lock that other processors skip.
 * ponytail: the provider call runs inside the transaction, like the other providers; the 5 s timeout bounds the lock.
 */
async function syncOne(tx: Tx, id: string, provider: AccessProvider, now: Date): Promise<boolean> {
  const due = new Date(now.getTime() - SYNC_INTERVAL_MS);
  const [s] = await tx`
    select id, org_id, market_id, name from access_sources
    where id = ${id} and revoked_at is null and (last_sync_at is null or last_sync_at <= ${due})
    for update skip locked`;
  if (!s) return false;
  try {
    const listed = await withTimeout(
      provider.listPeople({ id, marketId: s.market_id as string, name: s.name as string }),
    );
    const people = cleanPeople(listed);
    // A savepoint: a SQL error here must not abort the transaction that records the failure below.
    await tx.savepoint(async (sp) => {
      for (let i = 0; i < people.length; i += CHUNK) {
        const rows = people.slice(i, i + CHUNK).map((p) => ({ external_id: p.externalId, name: p.name }));
        await sp`
          insert into access_people (org_id, source_id, external_id, name, active, synced_at)
          select ${s.org_id as string}, ${id}, x.external_id, x.name, true, ${now}
          from jsonb_to_recordset(${sp.json(rows)}) as x(external_id text, name text)
          on conflict (source_id, external_id) do update set
            name = case when access_people.forgotten_at is not null then null else excluded.name end,
            active = (access_people.forgotten_at is null),
            synced_at = excluded.synced_at`;
      }
      // The upsert stamped synced_at = now on everyone listed (now is unique per attempt): the rest left.
      await sp`
        update access_people set active = false
        where source_id = ${id} and active and synced_at is distinct from ${now}`;
      await sp`update access_sources set last_sync_at = ${now}, last_sync_error = null where id = ${id}`;
    });
  } catch (e) {
    const why = errorText(e);
    await tx`update access_sources set last_sync_at = ${now}, last_sync_error = ${why} where id = ${id}`;
  }
  return true;
}

/** Syncs every reader that is due. Meant for POST /api/internal/reconcile, once a minute. */
export async function syncAccessSources(
  now: Date = new Date(),
  limit = 50,
  provider?: AccessProvider,
): Promise<number> {
  const due = new Date(now.getTime() - SYNC_INTERVAL_MS);
  const rows = await adminSql`
    select id, org_id from access_sources
    where revoked_at is null and (last_sync_at is null or last_sync_at <= ${due})
    order by last_sync_at nulls first limit ${limit}`;
  if (rows.length === 0) return 0;
  const p = provider ?? getAccessProvider();
  let done = 0;
  for (const r of rows) {
    try {
      if (await withOrg(r.org_id as string, (tx) => syncOne(tx, r.id as string, p, now))) done++;
    } catch (e) {
      console.error("access sync failed for source", r.id, e); // one bad reader must not stop the others
    }
  }
  return done;
}

export const ACCESS_RETENTION_DAYS = 90;

/** Deletes entries older than the retention window, oldest first, in batches. Admin role: the app cannot delete. */
export async function purgeAccessEvents(now: Date = new Date(), limit = 5000): Promise<number> {
  const cutoff = new Date(now.getTime() - ACCESS_RETENTION_DAYS * 86_400_000);
  const rows = await adminSql`
    delete from access_events where id in (
      select id from access_events where occurred_at < ${cutoff} order by occurred_at limit ${limit}
    ) returning id`;
  return rows.length;
}

/**
 * The person asked to be forgotten: no name, no identifier on the old entries, and the sync never brings her back.
 * Idempotent: the first forgetting time is kept.
 */
export async function forgetAccessPerson(tx: Tx, personId: string, now: Date): Promise<void> {
  if (!uuid.safeParse(personId).success) throw new AppError("not_found");
  const [p] = await tx`
    update access_people set forgotten_at = coalesce(forgotten_at, ${now}), name = null, active = false
    where id = ${personId} returning source_id, external_id`;
  if (!p) throw new AppError("not_found");
  await tx`
    update access_events set person_external_id = null
    where source_id = ${p.source_id as string} and person_external_id = ${p.external_id as string}`;
}
