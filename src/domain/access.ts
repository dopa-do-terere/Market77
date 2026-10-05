import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { SourceAuth } from "@/access/auth";
import { AccessUnavailable, type AccessProvider } from "@/access/provider";
import { getAccessProvider } from "@/access/registry";
import { adminSql } from "@/db/client";
import { type Tx, withOrg } from "@/db/tenant";
import { AppError, isForeignKeyViolation, isInsufficientPrivilege } from "@/lib/errors";
import { isRealDay } from "./lots";
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

// Postgres refuses NUL (22021) and a lone surrogate would be stored as another id: reject both as bad input.
const storable = (s: string) => !/\u0000|\p{Cs}/u.test(s);

// zod drops unknown keys: nothing but these four fields is ever stored.
const EventInput = z.object({
  occurredAt: z.string().datetime({ offset: true }),
  eventId: z.string().min(1).max(64).refine(storable).optional(),
  personId: z.string().min(1).max(64).refine(storable).optional(),
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
  // Lock order as in the sync: reader first, then person. The reader lock also waits for a revocation in flight.
  const [src] = await tx`select revoked_at from access_sources where id = ${auth.sourceId} for no key update`;
  if (!src || src.revoked_at) throw new AppError("source_revoked");
  let personId = e.personId ?? null;
  if (personId) {
    // FOR SHARE (not KEY SHARE) conflicts with the forgetting UPDATE: either we wait for it and see forgotten_at,
    // or it waits for us and then anonymizes this entry. The filter stays out of WHERE so the lock is always taken.
    const [p] = await tx`
      select forgotten_at is not null as forgotten from access_people
      where source_id = ${auth.sourceId} and external_id = ${personId} for share`;
    if (p?.forgotten) personId = null; // she asked to be forgotten: no identifier is kept
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

// Not storable (see above): such an entry would fail the write on every run.
const Person = z.object({
  externalId: z.string().trim().min(1).max(64).refine(storable),
  name: z.string().trim().min(1).max(120).refine(storable),
});

const NO_PEOPLE = "no valid people in the reader answer";

/** Valid entries only; the first of a repeated id wins. */
function cleanPeople(listed: unknown): { externalId: string; name: string }[] {
  if (!Array.isArray(listed)) throw new Error(NO_PEOPLE);
  const seen = new Map<string, { externalId: string; name: string }>();
  for (const p of listed) {
    const r = Person.safeParse(p);
    if (r.success && !seen.has(r.data.externalId)) seen.set(r.data.externalId, r.data);
  }
  // A non-empty answer with nothing usable is a broken reader, not an empty one: keep the old list.
  if (listed.length > 0 && seen.size === 0) throw new Error(NO_PEOPLE);
  return [...seen.values()];
}

/** Error text kept on the source: fixed texts only, never a raw message (SQL or provider text may carry names). */
function errorText(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  // Only a SQLSTATE-shaped code: any other "code" could come from a provider and carry anything.
  if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return `sql error ${code}`;
  if (e instanceof AccessUnavailable) return "reader unavailable";
  const msg = e instanceof Error ? e.message : "";
  if (msg === "provider timeout" || msg === NO_PEOPLE) return msg;
  return "provider error";
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
  // Names of people who left the reader, or of a revoked reader (never synced again), go too.
  // Forgotten people stay: the sync must find them to never bring them back.
  await adminSql`
    delete from access_people
    where forgotten_at is null
      and (not active or source_id in (select id from access_sources where revoked_at is not null))
      and coalesce(synced_at, created_at) < ${cutoff}`;
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

export type AccessSourceRow = {
  id: string;
  name: string;
  createdAt: Date;
  revokedAt: Date | null;
  lastSyncAt: Date | null;
  lastSyncError: string | null;
  lastEventAt: Date | null;
  activePeople: number;
};

export async function listAccessSources(tx: Tx, marketId: string): Promise<AccessSourceRow[]> {
  const rows = await tx`
    select s.id, s.name, s.created_at, s.revoked_at, s.last_sync_at, s.last_sync_error, s.last_event_at,
      (select count(*)::int from access_people p where p.source_id = s.id and p.active) as active_people
    from access_sources s where s.market_id = ${marketId} order by s.created_at desc, s.id`;
  return rows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    createdAt: r.created_at as Date,
    revokedAt: (r.revoked_at as Date | null) ?? null,
    lastSyncAt: (r.last_sync_at as Date | null) ?? null,
    lastSyncError: (r.last_sync_error as string | null) ?? null,
    lastEventAt: (r.last_event_at as Date | null) ?? null,
    activePeople: r.active_people as number,
  }));
}

export type AccessPersonRow = {
  id: string;
  sourceName: string;
  externalId: string;
  name: string | null;
  active: boolean;
  forgotten: boolean;
};

export async function listAccessPeople(tx: Tx, marketId: string): Promise<AccessPersonRow[]> {
  const rows = await tx`
    select p.id, s.name as source_name, p.external_id, p.name, p.active, (p.forgotten_at is not null) as forgotten
    from access_people p join access_sources s on s.id = p.source_id
    where s.market_id = ${marketId}
    order by (p.forgotten_at is not null), lower(p.name), p.external_id`;
  return rows.map((r) => ({
    id: r.id as string,
    sourceName: r.source_name as string,
    externalId: r.external_id as string,
    name: (r.name as string | null) ?? null,
    active: r.active as boolean,
    forgotten: r.forgotten as boolean,
  }));
}

export type AccessEventRow = {
  id: string;
  occurredAt: Date;
  sourceName: string;
  personExternalId: string | null;
  personName: string | null;
  status: "known" | "unregistered" | "anonymous";
};

export async function listRecentAccess(tx: Tx, marketId: string, limit = 100): Promise<AccessEventRow[]> {
  const rows = await tx`
    select e.id, e.occurred_at, s.name as source_name, e.person_external_id, p.name as person_name
    from access_events e
    join access_sources s on s.id = e.source_id
    left join access_people p on p.source_id = e.source_id and p.external_id = e.person_external_id
    where e.market_id = ${marketId}
    order by e.occurred_at desc, e.id limit ${limit}`;
  return rows.map((r) => {
    const personExternalId = (r.person_external_id as string | null) ?? null;
    const personName = (r.person_name as string | null) ?? null;
    return {
      id: r.id as string,
      occurredAt: r.occurred_at as Date,
      sourceName: r.source_name as string,
      personExternalId,
      personName,
      status: personExternalId === null ? "anonymous" : personName !== null ? "known" : "unregistered",
    };
  });
}

export type DailyAccessRow = {
  day: string;
  entries: number;
  people: number;
  paidSales: number;
  salesPerEntry: number | null;
};

/**
 * One row per local day (market time zone), newest first, including quiet days.
 * ponytail: "people" counts distinct (reader, person id); the same person on two readers counts twice.
 */
export async function dailyAccessSummary(tx: Tx, marketId: string, now: Date, days = 14): Promise<DailyAccessRow[]> {
  const rows = await tx`
    with m as (
      select timezone as tz, ((${now}::timestamptz at time zone timezone)::date - ${days - 1}::int) as first_day
      from markets where id = ${marketId}
    ),
    d as (select m.first_day + g as day from m, generate_series(0, ${days - 1}) g),
    e as (
      select (ev.occurred_at at time zone m.tz)::date as day, count(*)::int as entries,
        count(distinct (ev.source_id, ev.person_external_id)) filter (where ev.person_external_id is not null)::int as people
      from access_events ev, m
      where ev.market_id = ${marketId} and ev.occurred_at >= (m.first_day::timestamp at time zone m.tz)
      group by 1
    ),
    s as (
      select (sa.paid_at at time zone m.tz)::date as day, count(*)::int as paid
      from sales sa, m
      where sa.market_id = ${marketId} and sa.status = 'paid' and sa.paid_at >= (m.first_day::timestamp at time zone m.tz)
      group by 1
    )
    select to_char(d.day, 'YYYY-MM-DD') as day, coalesce(e.entries, 0) as entries,
      coalesce(e.people, 0) as people, coalesce(s.paid, 0) as paid_sales
    from d left join e on e.day = d.day left join s on s.day = d.day
    order by d.day desc`;
  return rows.map((r) => {
    const entries = r.entries as number;
    const paidSales = r.paid_sales as number;
    return {
      day: r.day as string,
      entries,
      people: r.people as number,
      paidSales,
      salesPerEntry: entries > 0 ? paidSales / entries : null,
    };
  });
}

export type HourlyAccessRow = { hour: number; entries: number };

/** The 24 local hours of one day (YYYY-MM-DD) in the market time zone. */
export async function hourlyAccess(tx: Tx, marketId: string, day: string): Promise<HourlyAccessRow[]> {
  if (!isRealDay(day)) throw new AppError("invalid_input", "day must be a real date (YYYY-MM-DD)");
  const rows = await tx`
    with m as (select timezone as tz from markets where id = ${marketId}),
    h as (select generate_series(0, 23) as hour),
    e as (
      select extract(hour from ev.occurred_at at time zone m.tz)::int as hour, count(*)::int as entries
      from access_events ev, m
      where ev.market_id = ${marketId} and (ev.occurred_at at time zone m.tz)::date = ${day}::date
      group by 1
    )
    select h.hour, coalesce(e.entries, 0) as entries from h left join e on e.hour = h.hour order by h.hour`;
  return rows.map((r) => ({ hour: r.hour as number, entries: r.entries as number }));
}
