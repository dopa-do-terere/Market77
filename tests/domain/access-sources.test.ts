import { beforeEach, describe, expect, it } from "vitest";
import { adminSql } from "@/db/client";
import { withOrg } from "@/db/tenant";
import { createAccessSource, hashAccessToken, revokeAccessSource } from "@/domain/access";
import { codeOf, makeOrg, resetDb, seedStore } from "../helpers";

beforeEach(resetDb);

const UNKNOWN = "00000000-0000-4000-8000-000000000000";

describe("access sources", () => {
  it("creates a reader, returns the token once and stores only its hash", async () => {
    const orgId = await makeOrg("A");
    const { marketId } = await seedStore(orgId);
    const { id, token } = await withOrg(orgId, (tx) => createAccessSource(tx, orgId, { marketId, name: "Porta A" }));
    expect(token.length).toBeGreaterThanOrEqual(40);
    const [row] = await adminSql`select token_hash, market_id, org_id, revoked_at, name from access_sources where id = ${id}`;
    expect(row.token_hash).toBe(hashAccessToken(token));
    expect(row.token_hash).not.toBe(token);
    expect([row.market_id, row.org_id, row.revoked_at, row.name]).toEqual([marketId, orgId, null, "Porta A"]);
  });

  it("gives every reader a different token", async () => {
    const orgId = await makeOrg("A");
    const { marketId } = await seedStore(orgId);
    const a = await withOrg(orgId, (tx) => createAccessSource(tx, orgId, { marketId, name: "Porta A" }));
    const b = await withOrg(orgId, (tx) => createAccessSource(tx, orgId, { marketId, name: "Porta B" }));
    expect(a.token).not.toBe(b.token);
  });

  it("refuses bad names and unknown or foreign markets", async () => {
    const a = await makeOrg("A");
    const b = await makeOrg("B");
    const mine = await seedStore(a);
    const theirs = await seedStore(b);
    const run = (raw: object) => codeOf(withOrg(a, (tx) => createAccessSource(tx, a, raw)));
    expect(await run({ marketId: mine.marketId, name: "x" })).toBe("invalid_input");
    expect(await run({ marketId: mine.marketId, name: "y".repeat(61) })).toBe("invalid_input");
    expect(await run({ marketId: "nope", name: "Porta A" })).toBe("invalid_input");
    expect(await run({ marketId: UNKNOWN, name: "Porta A" })).toBe("not_found");
    expect(await run({ marketId: theirs.marketId, name: "Porta A" })).toBe("not_found");
    expect(await adminSql`select id from access_sources`).toHaveLength(0);
  });

  it("revokes a reader, keeps the first revocation time and knows unknown ids", async () => {
    const orgId = await makeOrg("A");
    const other = await makeOrg("B");
    const { marketId } = await seedStore(orgId);
    const { id } = await withOrg(orgId, (tx) => createAccessSource(tx, orgId, { marketId, name: "Porta A" }));
    await withOrg(orgId, (tx) => revokeAccessSource(tx, id));
    const [first] = await adminSql`select revoked_at from access_sources where id = ${id}`;
    expect(first.revoked_at).not.toBeNull();
    await withOrg(orgId, (tx) => revokeAccessSource(tx, id));
    const [second] = await adminSql`select revoked_at from access_sources where id = ${id}`;
    expect(second.revoked_at).toEqual(first.revoked_at);
    expect(await codeOf(withOrg(orgId, (tx) => revokeAccessSource(tx, UNKNOWN)))).toBe("not_found");
    expect(await codeOf(withOrg(orgId, (tx) => revokeAccessSource(tx, "nope")))).toBe("not_found");
    expect(await codeOf(withOrg(other, (tx) => revokeAccessSource(tx, id)))).toBe("not_found");
  });
});
