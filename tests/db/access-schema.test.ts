import { beforeEach, describe, expect, it } from "vitest";
import { adminSql } from "@/db/client";
import { withOrg } from "@/db/tenant";
import { makeOrg, resetDb, seedAccessEvent, seedAccessSource, seedPerson, seedStore } from "../helpers";

beforeEach(resetDb);

const AT = new Date("2026-10-05T12:00:00Z");

async function setup(name = "A") {
  const orgId = await makeOrg(name);
  const { marketId } = await seedStore(orgId);
  const source = await seedAccessSource(orgId, marketId);
  return { orgId, marketId, source };
}

describe("phase 6 schema", () => {
  it("refuses malformed values", async () => {
    const { orgId, marketId, source } = await setup();
    const bad = (q: Promise<unknown>) => expect(q).rejects.toThrow(/check/);
    await bad(adminSql`update access_sources set name = 'x' where id = ${source.id}`);
    await bad(seedPerson(orgId, source.id, "", "Ana"));
    await bad(seedPerson(orgId, source.id, "u1", ""));
    await bad(
      adminSql`insert into access_events (org_id, market_id, source_id, occurred_at, kind)
        values (${orgId}, ${marketId}, ${source.id}, ${AT}, 'exit')`,
    );
    await bad(seedAccessEvent(orgId, marketId, source.id, { at: AT, personId: "p".repeat(65) }));
  });

  it("keeps one person per reader and one event id per reader", async () => {
    const { orgId, marketId, source } = await setup();
    await seedPerson(orgId, source.id, "u1", "Ana");
    await expect(seedPerson(orgId, source.id, "u1", "Outra")).rejects.toThrow(/duplicate key/);
    await seedAccessEvent(orgId, marketId, source.id, { at: AT, eventId: "e1" });
    await expect(seedAccessEvent(orgId, marketId, source.id, { at: AT, eventId: "e1" })).rejects.toThrow(
      /duplicate key/,
    );
    await seedAccessEvent(orgId, marketId, source.id, { at: AT }); // no event id: repeats are fine
    await seedAccessEvent(orgId, marketId, source.id, { at: AT });
    const other = await seedAccessSource(orgId, marketId);
    await seedAccessEvent(orgId, marketId, other.id, { at: AT, eventId: "e1" }); // same id, other reader
  });

  it("accepts a forgotten person with no name", async () => {
    const { orgId, source } = await setup();
    const id = await seedPerson(orgId, source.id, "u1", "Ana");
    await adminSql`update access_people set name = null, forgotten_at = now() where id = ${id}`;
  });

  it("isolates the tables per tenant", async () => {
    const a = await setup("A");
    const b = await makeOrg("B");
    await seedPerson(a.orgId, a.source.id, "u1", "Ana");
    await seedAccessEvent(a.orgId, a.marketId, a.source.id, { at: AT });
    for (const t of ["access_sources", "access_people", "access_events"]) {
      expect(await withOrg(b, (tx) => tx.unsafe(`select id from ${t}`))).toEqual([]);
      expect(await withOrg(a.orgId, (tx) => tx.unsafe(`select id from ${t}`))).toHaveLength(1);
    }
  });

  it("lets the app role update but never delete access rows", async () => {
    const { orgId, marketId, source } = await setup();
    await seedPerson(orgId, source.id, "u1", "Ana");
    await seedAccessEvent(orgId, marketId, source.id, { at: AT });
    await withOrg(orgId, (tx) => tx`update access_sources set last_sync_error = 'x'`);
    await withOrg(orgId, (tx) => tx`update access_people set active = false`);
    await withOrg(orgId, (tx) => tx`update access_events set person_external_id = null`);
    for (const t of ["access_sources", "access_people", "access_events"]) {
      await expect(withOrg(orgId, (tx) => tx.unsafe(`delete from ${t}`))).rejects.toThrow(/permission denied/);
    }
  });
});
