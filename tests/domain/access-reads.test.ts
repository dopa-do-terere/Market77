import { beforeEach, describe, expect, it } from "vitest";
import { withOrg } from "@/db/tenant";
import {
  dailyAccessSummary,
  hourlyAccess,
  listAccessPeople,
  listAccessSources,
  listRecentAccess,
} from "@/domain/access";
import { codeOf, makeOrg, paidSale, resetDb, seedAccessEvent, seedAccessSource, seedPerson, seedSellable, seedStore } from "../helpers";

beforeEach(resetDb);

const NOW = new Date("2026-10-05T15:00:00Z"); // 2026-10-05 in Sao Paulo

async function setup(name = "A") {
  const orgId = await makeOrg(name);
  const store = await seedStore(orgId);
  const source = await seedAccessSource(orgId, store.marketId, { name: "Porta A" });
  return { orgId, store, marketId: store.marketId, source };
}

describe("sources and people", () => {
  it("lists readers with the count of active people, newest first", async () => {
    const { orgId, marketId, source } = await setup();
    await seedPerson(orgId, source.id, "u1", "Ana");
    await seedPerson(orgId, source.id, "u2", "Bia", { active: false });
    const newer = await seedAccessSource(orgId, marketId, { name: "Porta B" });
    const rows = await withOrg(orgId, (tx) => listAccessSources(tx, marketId));
    expect(rows.map((r) => [r.id, r.name, r.activePeople])).toEqual([
      [newer.id, "Porta B", 0],
      [source.id, "Porta A", 1],
    ]);
    expect(rows[1]).toMatchObject({ revokedAt: null, lastSyncAt: null, lastSyncError: null, lastEventAt: null });
  });

  it("lists people by name with the forgotten ones last", async () => {
    const { orgId, marketId, source } = await setup();
    await seedPerson(orgId, source.id, "u2", "Bia");
    await seedPerson(orgId, source.id, "u1", "Ana");
    await seedPerson(orgId, source.id, "u3", "Zé", { forgotten: true, active: false });
    const rows = await withOrg(orgId, (tx) => listAccessPeople(tx, marketId));
    expect(rows.map((r) => [r.externalId, r.name, r.sourceName, r.active, r.forgotten])).toEqual([
      ["u1", "Ana", "Porta A", true, false],
      ["u2", "Bia", "Porta A", true, false],
      ["u3", null, "Porta A", false, true],
    ]);
  });

  it("shows nothing of another market or organization", async () => {
    const a = await setup("A");
    const b = await setup("B");
    await seedPerson(a.orgId, a.source.id, "u1", "Ana");
    await seedAccessEvent(a.orgId, a.marketId, a.source.id, { at: NOW, personId: "u1" });
    expect(await withOrg(b.orgId, (tx) => listAccessPeople(tx, a.marketId))).toEqual([]);
    expect(await withOrg(b.orgId, (tx) => listRecentAccess(tx, a.marketId))).toEqual([]);
    expect(await withOrg(b.orgId, (tx) => listAccessSources(tx, a.marketId))).toEqual([]);
    expect(await withOrg(b.orgId, (tx) => dailyAccessSummary(tx, a.marketId, NOW))).toEqual([]);
  });
});

describe("recent access", () => {
  it("resolves names, tells unregistered from anonymous and orders by time, newest first", async () => {
    const { orgId, marketId, source } = await setup();
    await seedPerson(orgId, source.id, "u1", "Ana");
    const at = (m: number) => new Date(NOW.getTime() - m * 60_000);
    await seedAccessEvent(orgId, marketId, source.id, { at: at(3), personId: "u1" });
    await seedAccessEvent(orgId, marketId, source.id, { at: at(2), personId: "u9" });
    await seedAccessEvent(orgId, marketId, source.id, { at: at(1) });
    const rows = await withOrg(orgId, (tx) => listRecentAccess(tx, marketId));
    expect(rows.map((r) => [r.personExternalId, r.personName, r.status, r.sourceName])).toEqual([
      [null, null, "anonymous", "Porta A"],
      ["u9", null, "unregistered", "Porta A"],
      ["u1", "Ana", "known", "Porta A"],
    ]);
  });

  it("respects the limit", async () => {
    const { orgId, marketId, source } = await setup();
    for (let i = 0; i < 5; i++) await seedAccessEvent(orgId, marketId, source.id, { at: new Date(NOW.getTime() - i * 1000) });
    expect(await withOrg(orgId, (tx) => listRecentAccess(tx, marketId, 3))).toHaveLength(3);
  });
});

describe("daily summary", () => {
  it("returns one row per day in the market time zone, with zeros for quiet days", async () => {
    const { orgId, marketId } = await setup();
    const rows = await withOrg(orgId, (tx) => dailyAccessSummary(tx, marketId, NOW));
    expect(rows).toHaveLength(14);
    expect([rows[0].day, rows[13].day]).toEqual(["2026-10-05", "2026-09-22"]);
    expect(rows.every((r) => r.entries === 0 && r.paidSales === 0 && r.salesPerEntry === null)).toBe(true);
  });

  it("puts an entry near midnight on the right local day", async () => {
    const { orgId, marketId, source } = await setup();
    // 02:30Z is 23:30 of the 3rd in Sao Paulo; 03:30Z is 00:30 of the 4th.
    await seedAccessEvent(orgId, marketId, source.id, { at: new Date("2026-10-04T02:30:00Z") });
    await seedAccessEvent(orgId, marketId, source.id, { at: new Date("2026-10-04T03:30:00Z") });
    const rows = await withOrg(orgId, (tx) => dailyAccessSummary(tx, marketId, NOW));
    const byDay = Object.fromEntries(rows.map((r) => [r.day, r.entries]));
    expect([byDay["2026-10-03"], byDay["2026-10-04"]]).toEqual([1, 1]);
  });

  it("counts distinct people and crosses entries with paid sales of the same day", async () => {
    const { orgId, store, marketId, source } = await setup();
    const day = new Date("2026-10-03T15:00:00Z");
    for (const p of ["u1", "u1", "u2", null]) {
      await seedAccessEvent(orgId, marketId, source.id, { at: day, personId: p });
    }
    await seedSellable(orgId, store.marketId, { barcode: "7891000100103", priceCents: 500 });
    await paidSale(orgId, store, "7891000100103", 1, { now: day });
    await paidSale(orgId, store, "7891000100103", 1, { now: day });
    const rows = await withOrg(orgId, (tx) => dailyAccessSummary(tx, marketId, NOW));
    const d = rows.find((r) => r.day === "2026-10-03");
    expect(d).toMatchObject({ entries: 4, people: 2, paidSales: 2, salesPerEntry: 0.5 });
  });
});

describe("daily summary window", () => {
  it("ignores entries and paid sales older than the first day", async () => {
    const { orgId, store, marketId, source } = await setup();
    // 2026-09-22 is the first of the 14 days; 02:30Z on the 22nd is still the 21st in Sao Paulo.
    const before = new Date("2026-09-22T02:30:00Z");
    const first = new Date("2026-09-22T03:30:00Z");
    await seedAccessEvent(orgId, marketId, source.id, { at: before });
    await seedAccessEvent(orgId, marketId, source.id, { at: first });
    await seedSellable(orgId, store.marketId, { barcode: "7891000100103", priceCents: 500 });
    await paidSale(orgId, store, "7891000100103", 1, { now: before });
    await paidSale(orgId, store, "7891000100103", 1, { now: first });
    const rows = await withOrg(orgId, (tx) => dailyAccessSummary(tx, marketId, NOW));
    expect(rows.map((r) => r.day)).not.toContain("2026-09-21");
    expect(rows.reduce((n, r) => n + r.entries, 0)).toBe(1);
    expect(rows.reduce((n, r) => n + r.paidSales, 0)).toBe(1);
    expect(rows.find((r) => r.day === "2026-09-22")).toMatchObject({ entries: 1, paidSales: 1 });
  });
});

describe("hourly access", () => {
  it("returns 24 hours of the chosen local day", async () => {
    const { orgId, marketId, source } = await setup();
    for (const iso of ["2026-10-03T12:10:00Z", "2026-10-03T12:50:00Z", "2026-10-03T17:00:00Z"]) {
      await seedAccessEvent(orgId, marketId, source.id, { at: new Date(iso) }); // 09:xx and 14:00 in Sao Paulo
    }
    await seedAccessEvent(orgId, marketId, source.id, { at: new Date("2026-10-04T12:00:00Z") }); // another day
    const rows = await withOrg(orgId, (tx) => hourlyAccess(tx, marketId, "2026-10-03"));
    expect(rows).toHaveLength(24);
    expect(rows.filter((r) => r.entries > 0)).toEqual([
      { hour: 9, entries: 2 },
      { hour: 14, entries: 1 },
    ]);
  });

  it("refuses a malformed or impossible day", async () => {
    const { orgId, marketId } = await setup();
    const run = (d: string) => codeOf(withOrg(orgId, (tx) => hourlyAccess(tx, marketId, d)));
    expect(await run("hoje")).toBe("invalid_input");
    expect(await run("2026-02-30")).toBe("invalid_input");
    expect(await run("2026-10-3")).toBe("invalid_input");
  });
});
