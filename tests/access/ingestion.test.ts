import { beforeEach, describe, expect, it } from "vitest";
import { eventHandler } from "@/access/http";
import { adminSql } from "@/db/client";
import { makeOrg, resetDb, seedAccessSource, seedPerson, seedStore } from "../helpers";

beforeEach(resetDb);

const NOW = new Date("2026-10-05T15:00:00Z");
const iso = (ms: number) => new Date(NOW.getTime() + ms).toISOString();
const MIN = 60_000;
const DAY = 86_400_000;

async function setup() {
  const orgId = await makeOrg("A");
  const { marketId } = await seedStore(orgId);
  const source = await seedAccessSource(orgId, marketId);
  return { orgId, marketId, source };
}

const send = (token: string | undefined, body?: unknown, raw?: string) =>
  eventHandler(
    new Request("http://m77.test/api/access/events", {
      method: "POST",
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" },
      body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
    }),
    NOW,
  );
const json = async (r: Response) => (await r.json()) as Record<string, any>;
const events = () => adminSql`select * from access_events order by received_at, id`;

describe("event ingestion", () => {
  it("stores an entry in the market and organization of the reader", async () => {
    const { orgId, marketId, source } = await setup();
    const res = await send(source.token, { occurredAt: iso(-MIN), eventId: "e1", personId: "u1", kind: "entry" });
    const body = await json(res);
    expect([res.status, typeof body.id]).toEqual([201, "string"]);
    const [e] = await events();
    expect([e.org_id, e.market_id, e.source_id, e.person_external_id, e.event_id, e.kind]).toEqual([
      orgId,
      marketId,
      source.id,
      "u1",
      "e1",
      "entry",
    ]);
    expect(e.occurred_at).toEqual(new Date(NOW.getTime() - MIN));
    const [s] = await adminSql`select last_event_at from access_sources where id = ${source.id}`;
    expect(s.last_event_at).toEqual(NOW);
  });

  it("works with only the time, and ignores a body that tries to choose the market or add data", async () => {
    const { orgId, marketId, source } = await setup();
    const other = await seedStore(orgId);
    const res = await send(source.token, {
      occurredAt: iso(0),
      marketId: other.marketId,
      orgId: "00000000-0000-4000-8000-000000000000",
      photo: "BASE64-FACE-IMAGE",
      template: "SECRET",
    });
    expect(res.status).toBe(201);
    const [e] = await events();
    expect([e.market_id, e.person_external_id, e.event_id]).toEqual([marketId, null, null]);
    const [all] = await adminSql`select to_jsonb(e)::text as t from access_events e`;
    expect(all.t).not.toContain("BASE64-FACE-IMAGE");
    expect(all.t).not.toContain("SECRET");
  });

  it("answers 200 duplicate for a repeated event id and keeps one row", async () => {
    const { source } = await setup();
    await send(source.token, { occurredAt: iso(0), eventId: "e1" });
    const again = await send(source.token, { occurredAt: iso(0), eventId: "e1" });
    expect([again.status, await json(again)]).toEqual([200, { duplicate: true }]);
    expect(await events()).toHaveLength(1);
  });

  it("accepts the same event id from another reader and repeats without an event id", async () => {
    const { orgId, marketId, source } = await setup();
    const other = await seedAccessSource(orgId, marketId);
    await send(source.token, { occurredAt: iso(0), eventId: "e1" });
    await send(other.token, { occurredAt: iso(0), eventId: "e1" });
    await send(source.token, { occurredAt: iso(0) });
    await send(source.token, { occurredAt: iso(0) });
    expect(await events()).toHaveLength(4);
  });

  it("enforces the time window: 5 minutes ahead and 7 days back", async () => {
    const { source } = await setup();
    expect((await send(source.token, { occurredAt: iso(4 * MIN) })).status).toBe(201);
    expect((await send(source.token, { occurredAt: iso(6 * MIN) })).status).toBe(400);
    expect((await send(source.token, { occurredAt: iso(-6 * DAY) })).status).toBe(201);
    expect((await send(source.token, { occurredAt: iso(-8 * DAY) })).status).toBe(400);
    expect(await events()).toHaveLength(2);
  });

  it("answers 400 to bad fields and broken JSON without storing anything", async () => {
    const { source } = await setup();
    const bad = async (body: unknown, raw?: string) => {
      const r = await send(source.token, body, raw);
      expect([r.status, (await json(r)).error]).toEqual([400, "invalid_input"]);
    };
    await bad({});
    await bad({ occurredAt: "ontem" });
    await bad({ occurredAt: "2026-10-05" });
    await bad({ occurredAt: iso(0), kind: "exit" });
    await bad({ occurredAt: iso(0), personId: "" });
    await bad({ occurredAt: iso(0), personId: "p".repeat(65) });
    await bad({ occurredAt: iso(0), eventId: 7 });
    await bad(undefined, "{");
    await bad(undefined, "null");
    expect(await events()).toHaveLength(0);
  });

  it("answers 401 for a missing, wrong or revoked token and stores nothing", async () => {
    const { orgId, marketId, source } = await setup();
    const revoked = await seedAccessSource(orgId, marketId, { revoked: true });
    const noToken = await send(undefined, { occurredAt: iso(0) });
    expect([noToken.status, (await json(noToken)).error]).toEqual([401, "unauthorized"]);
    expect((await send("wrong", { occurredAt: iso(0) })).status).toBe(401);
    const gone = await send(revoked.token, { occurredAt: iso(0) });
    expect([gone.status, (await json(gone)).error]).toEqual([401, "source_revoked"]);
    expect(await events()).toHaveLength(0);
  });

  it("stores no identifier for a person who asked to be forgotten", async () => {
    const { orgId, source } = await setup();
    await seedPerson(orgId, source.id, "u1", "Ana", { forgotten: true });
    await send(source.token, { occurredAt: iso(0), personId: "u1" });
    await send(source.token, { occurredAt: iso(0), personId: "u2" });
    expect((await events()).map((e) => e.person_external_id).sort()).toEqual([null, "u2"].sort());
  });
});
