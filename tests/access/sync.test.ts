import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetFakeAccess, setFakeAccessMode, setFakePeople } from "@/access/fake-access";
import type { AccessProvider } from "@/access/provider";
import { adminSql } from "@/db/client";
import { withOrg } from "@/db/tenant";
import { revokeAccessSource, syncAccessSources } from "@/domain/access";
import { makeOrg, resetDb, seedAccessSource, seedPerson, seedStore } from "../helpers";

beforeEach(async () => {
  await resetDb();
  resetFakeAccess();
});

const NOW = new Date("2026-10-05T15:00:00Z");
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);

async function setup() {
  const orgId = await makeOrg("A");
  const { marketId } = await seedStore(orgId);
  const source = await seedAccessSource(orgId, marketId);
  return { orgId, marketId, source };
}
const people = (sourceId: string) =>
  adminSql`select external_id, name, active, forgotten_at from access_people where source_id = ${sourceId} order by external_id`;
const src = async (id: string) =>
  (await adminSql`select last_sync_at, last_sync_error from access_sources where id = ${id}`)[0];

describe("people sync", () => {
  it("stores the people the reader reports and stamps the source", async () => {
    const { source } = await setup();
    setFakePeople(source.id, [
      { externalId: "u1", name: "Ana" },
      { externalId: "u2", name: "Bia" },
    ]);
    expect(await syncAccessSources(NOW)).toBe(1);
    expect((await people(source.id)).map((p) => [p.external_id, p.name, p.active])).toEqual([
      ["u1", "Ana", true],
      ["u2", "Bia", true],
    ]);
    expect(await src(source.id)).toEqual({ last_sync_at: NOW, last_sync_error: null });
  });

  it("syncs a reader at most once every 10 minutes", async () => {
    const { source } = await setup();
    await syncAccessSources(NOW);
    expect(await syncAccessSources(minutes(9))).toBe(0);
    expect(await syncAccessSources(minutes(10))).toBe(1);
    expect((await src(source.id)).last_sync_at).toEqual(minutes(10));
  });

  it("updates names, deactivates people who left and reactivates them when they return", async () => {
    const { source } = await setup();
    setFakePeople(source.id, [
      { externalId: "u1", name: "Ana" },
      { externalId: "u2", name: "Bia" },
    ]);
    await syncAccessSources(NOW);
    setFakePeople(source.id, [{ externalId: "u1", name: "Ana Maria" }]);
    await syncAccessSources(minutes(10));
    expect((await people(source.id)).map((p) => [p.external_id, p.name, p.active])).toEqual([
      ["u1", "Ana Maria", true],
      ["u2", "Bia", false],
    ]);
    setFakePeople(source.id, [
      { externalId: "u1", name: "Ana Maria" },
      { externalId: "u2", name: "Bia" },
    ]);
    await syncAccessSources(minutes(20));
    expect((await people(source.id)).map((p) => p.active)).toEqual([true, true]);
  });

  it("deactivates everyone when the reader reports an empty list", async () => {
    const { source } = await setup();
    setFakePeople(source.id, [{ externalId: "u1", name: "Ana" }]);
    await syncAccessSources(NOW);
    setFakePeople(source.id, []);
    await syncAccessSources(minutes(10));
    expect((await people(source.id)).map((p) => p.active)).toEqual([false]);
    expect((await src(source.id)).last_sync_error).toBeNull();
  });

  it("skips entries without an id or a name and keeps the first of a repeated id", async () => {
    const { source } = await setup();
    setFakePeople(source.id, [
      { externalId: "u1", name: "Ana" },
      { externalId: "u1", name: "Outra" },
      { externalId: "", name: "Sem id" },
      { externalId: "u3", name: "   " },
      { externalId: "u4", name: "Dan" },
    ]);
    await syncAccessSources(NOW);
    expect((await people(source.id)).map((p) => [p.external_id, p.name])).toEqual([
      ["u1", "Ana"],
      ["u4", "Dan"],
    ]);
  });

  it("keeps the old list and records the error when the reader is down", async () => {
    const { source } = await setup();
    setFakePeople(source.id, [{ externalId: "u1", name: "Ana" }]);
    await syncAccessSources(NOW);
    setFakeAccessMode("down");
    expect(await syncAccessSources(minutes(10))).toBe(1);
    expect((await people(source.id)).map((p) => [p.name, p.active])).toEqual([["Ana", true]]);
    const s = await src(source.id);
    expect(s.last_sync_at).toEqual(minutes(10));
    expect(s.last_sync_error).toMatch(/unavailable/);
    setFakeAccessMode("ok");
    await syncAccessSources(minutes(20));
    expect((await src(source.id)).last_sync_error).toBeNull();
  });

  it("never recreates, renames or reactivates a forgotten person", async () => {
    const { orgId, source } = await setup();
    await seedPerson(orgId, source.id, "u1", "Ana", { forgotten: true, active: false });
    setFakePeople(source.id, [
      { externalId: "u1", name: "Ana de novo" },
      { externalId: "u2", name: "Bia" },
    ]);
    await syncAccessSources(NOW);
    const rows = await people(source.id);
    expect(rows.map((p) => [p.external_id, p.name, p.active])).toEqual([
      ["u1", null, false],
      ["u2", "Bia", true],
    ]);
    expect(rows[0].forgotten_at).not.toBeNull();
  });

  it("skips a revoked reader", async () => {
    const { orgId, source } = await setup();
    await withOrg(orgId, (tx) => revokeAccessSource(tx, source.id));
    expect(await syncAccessSources(NOW)).toBe(0);
    expect((await src(source.id)).last_sync_at).toBeNull();
  });

  it("counts a SQL failure in the middle as a failed sync and keeps the transaction usable", async () => {
    const { source } = await setup();
    setFakePeople(source.id, [{ externalId: "u1", name: "Ana" }]);
    await syncAccessSources(NOW);
    setFakePeople(source.id, [
      { externalId: "u2", name: "Bia" },
      { externalId: "boom", name: "Falha" },
    ]);
    await adminSql.unsafe(
      "alter table access_people add constraint test_block check (external_id <> 'boom') not valid",
    );
    try {
      expect(await syncAccessSources(minutes(10))).toBe(1);
    } finally {
      await adminSql.unsafe("alter table access_people drop constraint test_block");
    }
    expect((await people(source.id)).map((p) => [p.external_id, p.active])).toEqual([["u1", true]]);
    const s = await src(source.id);
    expect(s.last_sync_at).toEqual(minutes(10));
    expect(s.last_sync_error).toMatch(/^sql error 23514$/);
  });

  it("skips entries with a NUL or a lone surrogate and syncs the rest", async () => {
    const { source } = await setup();
    setFakePeople(source.id, [
      { externalId: "bad\u0000id", name: "Nul" },
      { externalId: "u2", name: "Nome\u0000ruim" },
      { externalId: "u3", name: "Sur\ud800" },
      { externalId: "u4", name: "Dan" },
    ]);
    await syncAccessSources(NOW);
    expect((await people(source.id)).map((p) => p.external_id)).toEqual(["u4"]);
    expect((await src(source.id)).last_sync_error).toBeNull();
  });

  it("treats a non-array answer or a list of only invalid entries as a failure and keeps the list", async () => {
    const { source } = await setup();
    setFakePeople(source.id, [{ externalId: "u1", name: "Ana" }]);
    await syncAccessSources(NOW);
    const answer = (v: unknown): AccessProvider => ({ name: "x", listPeople: async () => v as never });
    expect(await syncAccessSources(minutes(10), 50, answer({ people: [] }))).toBe(1);
    expect((await src(source.id)).last_sync_error).toMatch(/no valid people/);
    expect(await syncAccessSources(minutes(20), 50, answer([{ externalId: "", name: "" }]))).toBe(1);
    expect((await src(source.id)).last_sync_error).toMatch(/no valid people/);
    expect((await people(source.id)).map((p) => [p.external_id, p.active])).toEqual([["u1", true]]);
  });

  it("keeps going when one reader blows up", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { orgId, marketId, source: a } = await setup();
    const b = await seedAccessSource(orgId, marketId, { name: "Leitor 2" });
    const provider: AccessProvider = {
      name: "mixed",
      listPeople: async (s) => {
        if (s.id === a.id) throw new Error("boom");
        return [{ externalId: "u9", name: "Zé" }];
      },
    };
    expect(await syncAccessSources(NOW, 50, provider)).toBe(2);
    expect((await src(a.id)).last_sync_error).toBe("provider error");
    expect((await people(b.id)).map((p) => p.external_id)).toEqual(["u9"]);
  });

  it("syncs a reader once when two processors run together", async () => {
    const { source } = await setup();
    setFakePeople(source.id, [{ externalId: "u1", name: "Ana" }]);
    const [x, y] = await Promise.all([syncAccessSources(NOW), syncAccessSources(NOW)]);
    expect(x + y).toBe(1);
    expect(await people(source.id)).toHaveLength(1);
  });

  it("syncs a long list in chunks", async () => {
    const { source } = await setup();
    setFakePeople(
      source.id,
      Array.from({ length: 1200 }, (_, i) => ({ externalId: `u${i}`, name: `Pessoa ${i}` })),
    );
    await syncAccessSources(NOW);
    expect(await people(source.id)).toHaveLength(1200);
  });
});
