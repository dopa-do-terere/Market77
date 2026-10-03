import { beforeEach, describe, expect, it } from "vitest";
import { adminSql } from "@/db/client";
import { withOrg } from "@/db/tenant";
import { createTerminal, hashTerminalToken, listTerminals, revokeTerminal } from "@/domain/terminals";
import { requireTerminal } from "@/pdv/auth";
import { codeOf, makeOrg, resetDb, seedStore } from "../helpers";

beforeEach(resetDb);

const reqWith = (token?: string) =>
  new Request("http://m77.test/api/pdv/ping", {
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
  });

async function setup() {
  const orgId = await makeOrg("A");
  const { marketId } = await seedStore(orgId);
  const made = await withOrg(orgId, (tx) => createTerminal(tx, orgId, { marketId, name: "Totem 1" }));
  return { orgId, marketId, ...made };
}

describe("terminals", () => {
  it("returns the plain token once and stores only its hash", async () => {
    const { id, token } = await setup();
    expect(token.length).toBeGreaterThanOrEqual(43);
    const [row] = await adminSql`select token_hash from terminals where id = ${id}`;
    expect(row.token_hash).toBe(hashTerminalToken(token));
    expect(row.token_hash).not.toBe(token);
  });

  it("lists terminals with the market name", async () => {
    const { orgId } = await setup();
    const list = await withOrg(orgId, (tx) => listTerminals(tx));
    expect(list.map((t) => [t.name, t.marketName, t.revokedAt])).toEqual([["Totem 1", "Loja", null]]);
  });

  it("rejects short names, malformed market ids and another tenant's market", async () => {
    const a = await makeOrg("A");
    const b = await makeOrg("B");
    const mine = await seedStore(a);
    const theirs = await seedStore(b);
    const make = (marketId: string, name = "Totem") =>
      withOrg(a, (tx) => createTerminal(tx, a, { marketId, name }));
    expect(await codeOf(make(mine.marketId, "x"))).toBe("invalid_input");
    expect(await codeOf(make("not-a-uuid"))).toBe("invalid_input");
    expect(await codeOf(make(theirs.marketId))).toBe("not_found");
  });

  it("revokes a terminal and treats unknown or foreign ids as not_found", async () => {
    const { orgId, id } = await setup();
    await withOrg(orgId, (tx) => revokeTerminal(tx, id));
    const [row] = await adminSql`select revoked_at from terminals where id = ${id}`;
    expect(row.revoked_at).not.toBeNull();
    expect(await codeOf(withOrg(orgId, (tx) => revokeTerminal(tx, "nope")))).toBe("not_found");
    const other = await makeOrg("B");
    expect(await codeOf(withOrg(other, (tx) => revokeTerminal(tx, id)))).toBe("not_found");
  });
});

describe("requireTerminal", () => {
  it("resolves a valid token to the terminal, organization and market", async () => {
    const { orgId, marketId, id, token } = await setup();
    expect(await requireTerminal(reqWith(token))).toEqual({ terminalId: id, orgId, marketId });
  });

  it("rejects a missing header and a garbage token as unauthorized", async () => {
    await setup();
    expect(await codeOf(requireTerminal(reqWith()))).toBe("unauthorized");
    expect(await codeOf(requireTerminal(reqWith("garbage")))).toBe("unauthorized");
    expect(await codeOf(requireTerminal(new Request("http://m77.test", { headers: { authorization: "Basic abc" } })))).toBe("unauthorized");
  });

  it("rejects a revoked token as terminal_revoked", async () => {
    const { orgId, id, token } = await setup();
    await withOrg(orgId, (tx) => revokeTerminal(tx, id));
    expect(await codeOf(requireTerminal(reqWith(token)))).toBe("terminal_revoked");
  });
});
