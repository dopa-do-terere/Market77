import { beforeEach, describe, expect, it } from "vitest";
import { adminSql } from "@/db/client";
import { withOrg } from "@/db/tenant";
import { ACCESS_RETENTION_DAYS, forgetAccessPerson, purgeAccessEvents } from "@/domain/access";
import { codeOf, makeOrg, resetDb, seedAccessEvent, seedAccessSource, seedPerson, seedStore } from "../helpers";

beforeEach(resetDb);

const NOW = new Date("2026-10-05T15:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const UNKNOWN = "00000000-0000-4000-8000-000000000000";

async function setup() {
  const orgId = await makeOrg("A");
  const { marketId } = await seedStore(orgId);
  const source = await seedAccessSource(orgId, marketId);
  return { orgId, marketId, source };
}
const count = async () => (await adminSql`select count(*)::int as n from access_events`)[0].n as number;

describe("retention", () => {
  it("keeps 90 days and deletes what is older, across tenants", async () => {
    expect(ACCESS_RETENTION_DAYS).toBe(90);
    const a = await setup();
    const b = await setup();
    await seedAccessEvent(a.orgId, a.marketId, a.source.id, { at: daysAgo(89) });
    await seedAccessEvent(a.orgId, a.marketId, a.source.id, { at: daysAgo(91) });
    await seedAccessEvent(b.orgId, b.marketId, b.source.id, { at: daysAgo(120) });
    expect(await purgeAccessEvents(NOW)).toBe(2);
    expect(await count()).toBe(1);
  });

  it("measures the cutoff from the given time, not from the clock", async () => {
    const { orgId, marketId, source } = await setup();
    await seedAccessEvent(orgId, marketId, source.id, { at: daysAgo(89) });
    expect(await purgeAccessEvents(NOW)).toBe(0);
    expect(await purgeAccessEvents(new Date(NOW.getTime() + 2 * 86_400_000))).toBe(1);
  });

  it("deletes in batches, oldest first", async () => {
    const { orgId, marketId, source } = await setup();
    for (const d of [100, 95, 92]) await seedAccessEvent(orgId, marketId, source.id, { at: daysAgo(d) });
    expect(await purgeAccessEvents(NOW, 2)).toBe(2);
    const [left] = await adminSql`select occurred_at from access_events`;
    expect(left.occurred_at).toEqual(daysAgo(92));
    expect(await purgeAccessEvents(NOW, 2)).toBe(1);
    expect(await purgeAccessEvents(NOW, 2)).toBe(0);
  });
});

describe("forgetting a person", () => {
  it("clears the name, anonymizes the old events and marks her forgotten", async () => {
    const { orgId, marketId, source } = await setup();
    const id = await seedPerson(orgId, source.id, "u1", "Ana");
    await seedPerson(orgId, source.id, "u2", "Bia");
    await seedAccessEvent(orgId, marketId, source.id, { at: NOW, personId: "u1" });
    await seedAccessEvent(orgId, marketId, source.id, { at: NOW, personId: "u1" });
    await seedAccessEvent(orgId, marketId, source.id, { at: NOW, personId: "u2" });
    await withOrg(orgId, (tx) => forgetAccessPerson(tx, id, NOW));
    const [p] = await adminSql`select name, active, forgotten_at from access_people where id = ${id}`;
    expect([p.name, p.active, p.forgotten_at]).toEqual([null, false, NOW]);
    const ev = await adminSql`select person_external_id from access_events order by id`;
    expect(ev.map((e) => e.person_external_id).sort()).toEqual([null, null, "u2"].sort());
    const [bia] = await adminSql`select name, active from access_people where external_id = 'u2'`;
    expect([bia.name, bia.active]).toEqual(["Bia", true]);
  });

  it("is idempotent and keeps the first forgetting time", async () => {
    const { orgId, source } = await setup();
    const id = await seedPerson(orgId, source.id, "u1", "Ana");
    await withOrg(orgId, (tx) => forgetAccessPerson(tx, id, NOW));
    await withOrg(orgId, (tx) => forgetAccessPerson(tx, id, new Date(NOW.getTime() + 60_000)));
    const [p] = await adminSql`select forgotten_at from access_people where id = ${id}`;
    expect(p.forgotten_at).toEqual(NOW);
  });

  it("leaves the same identifier of another reader alone", async () => {
    const { orgId, marketId, source } = await setup();
    const other = await seedAccessSource(orgId, marketId, { name: "Leitor 2" });
    const id = await seedPerson(orgId, source.id, "u1", "Ana");
    await seedPerson(orgId, other.id, "u1", "Ana 2");
    await seedAccessEvent(orgId, marketId, other.id, { at: NOW, personId: "u1" });
    await withOrg(orgId, (tx) => forgetAccessPerson(tx, id, NOW));
    const [e] = await adminSql`select person_external_id from access_events`;
    expect(e.person_external_id).toBe("u1");
  });

  it("does not find unknown, malformed or other-tenant people", async () => {
    const a = await setup();
    const b = await setup();
    const theirs = await seedPerson(b.orgId, b.source.id, "u1", "Ana");
    const run = (id: string) => codeOf(withOrg(a.orgId, (tx) => forgetAccessPerson(tx, id, NOW)));
    expect(await run(UNKNOWN)).toBe("not_found");
    expect(await run("nope")).toBe("not_found");
    expect(await run(theirs)).toBe("not_found");
    const [p] = await adminSql`select name from access_people where id = ${theirs}`;
    expect(p.name).toBe("Ana");
  });
});
