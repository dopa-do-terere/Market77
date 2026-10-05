import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { POST as reconcileRoute } from "@/app/api/internal/reconcile/route";
import { resetFakeAccess, setFakePeople } from "@/access/fake-access";
import { adminSql } from "@/db/client";
import { makeOrg, resetDb, seedAccessEvent, seedAccessSource, seedStore } from "../helpers";

beforeEach(async () => {
  await resetDb();
  resetFakeAccess();
});
afterEach(() => vi.unstubAllEnvs());

it("the reconcile route also syncs the readers and purges old entries", async () => {
  vi.stubEnv("RECONCILE_SECRET", "s3cret");
  const orgId = await makeOrg("A");
  const { marketId } = await seedStore(orgId);
  const source = await seedAccessSource(orgId, marketId);
  setFakePeople(source.id, [{ externalId: "u1", name: "Ana" }]);
  await seedAccessEvent(orgId, marketId, source.id, { at: new Date(Date.now() - 100 * 86_400_000) });
  await seedAccessEvent(orgId, marketId, source.id, { at: new Date() });
  const res = await reconcileRoute(
    new Request("http://m77.test/api/internal/reconcile", { method: "POST", headers: { "x-reconcile-secret": "s3cret" } }),
  );
  expect([res.status, await res.json()]).toEqual([200, { visited: 0, fiscal: 0, access: { synced: 1, purged: 1 } }]);
  expect((await adminSql`select name from access_people`).map((p) => p.name)).toEqual(["Ana"]);
  expect(await adminSql`select id from access_events`).toHaveLength(1);
});
