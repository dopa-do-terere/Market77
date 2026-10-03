import { gzipSync } from "node:zlib";
import { beforeEach, describe, expect, it } from "vitest";
import { heartbeatHandler, releaseHandler, resultHandler } from "@/agent/http";
import { releaseStore } from "@/agent/releases";
import { adminSql } from "@/db/client";
import { withOrg } from "@/db/tenant";
import { REDELIVER_AFTER_MS, createCommand, listCommands } from "@/domain/agent";
import { createTerminal, listTerminals, revokeTerminal } from "@/domain/terminals";
import { makeOrg, makeUser, resetDb, seedStore } from "../helpers";

beforeEach(resetDb);

const BEAT = { agentVersion: "1.0.0", pdvStatus: "running" };
const json = async (r: Response) => (await r.json()) as Record<string, any>;

const post = (token: string | undefined, body?: unknown, raw?: string) =>
  new Request("http://m77.test/api/agent/x", {
    method: "POST",
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });

async function setup() {
  const orgId = await makeOrg("A");
  const userId = await makeUser(`u${Math.random()}@x.com`);
  const { marketId } = await seedStore(orgId);
  const mk = (name: string) => withOrg(orgId, (tx) => createTerminal(tx, orgId, { marketId, name }));
  const first = await mk("Totem 1");
  const send = (terminalId: string, type: string, version?: string) =>
    withOrg(orgId, (tx) => createCommand(tx, orgId, userId, { terminalId, type, version }, new Date()));
  return { orgId, userId, marketId, mk, send, terminalId: first.id, token: first.token };
}
type Setup = Awaited<ReturnType<typeof setup>>;
const beat = (s: Setup, now?: Date) => heartbeatHandler(post(s.token, BEAT), now);

describe("agent authentication", () => {
  it("answers 401 without a token and terminal_revoked for a revoked terminal, on every route", async () => {
    const s = await setup();
    expect((await heartbeatHandler(post(undefined, BEAT))).status).toBe(401);
    expect((await resultHandler(post(undefined, { ok: true }), "x")).status).toBe(401);
    expect((await releaseHandler(post(undefined), "1.0.0")).status).toBe(401);
    await withOrg(s.orgId, (tx) => revokeTerminal(tx, s.terminalId));
    for (const res of [
      await heartbeatHandler(post(s.token, BEAT)),
      await resultHandler(post(s.token, { ok: true }), "x"),
      await releaseHandler(post(s.token), "1.0.0"),
    ]) {
      expect([res.status, (await json(res)).error]).toEqual([401, "terminal_revoked"]);
    }
  });
});

describe("heartbeat", () => {
  it("records the state and answers with no command", async () => {
    const s = await setup();
    const res = await beat(s);
    expect([res.status, await json(res)]).toEqual([200, { command: null }]);
    const [t] = await withOrg(s.orgId, (tx) => listTerminals(tx));
    expect([t.agentVersion, t.pdvStatus, t.lastHeartbeatAt === null]).toEqual(["1.0.0", "running", false]);
  });

  it("answers 400 to a bad body and to broken JSON, never 500", async () => {
    const s = await setup();
    expect((await heartbeatHandler(post(s.token, { agentVersion: "1.0.0" }))).status).toBe(400);
    expect((await heartbeatHandler(post(s.token, undefined, "{"))).status).toBe(400);
    expect((await heartbeatHandler(post(s.token, undefined, "null"))).status).toBe(400);
  });

  it("delivers a command once and redelivers it only after 2 minutes without a result", async () => {
    const s = await setup();
    await s.send(s.terminalId, "restart_pdv");
    const first = (await json(await beat(s))).command;
    expect(first.type).toBe("restart_pdv");
    expect((await json(await beat(s))).command).toBeNull();
    const later = new Date(Date.now() + REDELIVER_AFTER_MS + 5000);
    expect((await json(await beat(s, later))).command.id).toBe(first.id);
  });

  it("delivers to exactly one of several simultaneous heartbeats", async () => {
    const s = await setup();
    await s.send(s.terminalId, "reboot");
    const got = await Promise.all([1, 2, 3, 4, 5].map(async () => (await json(await beat(s))).command));
    expect(got.filter((c) => c !== null)).toHaveLength(1);
  });

  it("does not deliver another terminal's command", async () => {
    const s = await setup();
    const other = await s.mk("Outro");
    await s.send(other.id, "reboot");
    expect((await json(await beat(s))).command).toBeNull();
  });

  it("never delivers a command that sat in the queue for more than 10 minutes", async () => {
    const s = await setup();
    await withOrg(s.orgId, (tx) => tx`
      insert into terminal_commands (org_id, terminal_id, type, created_at)
      values (${s.orgId}, ${s.terminalId}, 'reboot', now() - interval '11 minutes')`);
    expect((await json(await beat(s))).command).toBeNull();
    const [row] = await withOrg(s.orgId, (tx) => listCommands(tx, s.terminalId));
    expect([row.status, row.error]).toEqual(["failed", "expired"]);
  });

  it("gives an update command its version and package hash", async () => {
    const s = await setup();
    const meta = await releaseStore.put("1.2.3", gzipSync(Buffer.from("pkg")));
    await s.send(s.terminalId, "update", "1.2.3");
    const cmd = (await json(await beat(s))).command;
    expect(cmd).toMatchObject({ type: "update", version: "1.2.3", sha256: meta.sha256 });
  });

  it("fails an update whose package does not exist and answers with no command", async () => {
    const s = await setup();
    await s.send(s.terminalId, "update", "9.9.9");
    expect((await json(await beat(s))).command).toBeNull();
    const [row] = await withOrg(s.orgId, (tx) => listCommands(tx, s.terminalId));
    expect([row.status, row.error]).toEqual(["failed", "release_not_found"]);
  });
});

describe("command result", () => {
  async function delivered(s: Setup) {
    await s.send(s.terminalId, "reboot");
    return (await json(await beat(s))).command.id as string;
  }

  it("closes the command and is idempotent", async () => {
    const s = await setup();
    const id = await delivered(s);
    const first = await resultHandler(post(s.token, { ok: true }), id);
    expect([first.status, await json(first)]).toEqual([200, { ok: true }]);
    const again = await resultHandler(post(s.token, { ok: false, error: "late" }), id);
    expect(again.status).toBe(200);
    const [row] = await withOrg(s.orgId, (tx) => listCommands(tx, s.terminalId));
    expect([row.status, row.error]).toEqual(["succeeded", null]);
  });

  it("answers 404 for another terminal's command and for malformed ids, 400 for a bad body", async () => {
    const s = await setup();
    const id = await delivered(s);
    const other = await s.mk("Outro");
    expect((await resultHandler(post(other.token, { ok: true }), id)).status).toBe(404);
    expect((await resultHandler(post(s.token, { ok: true }), "nope")).status).toBe(404);
    expect((await resultHandler(post(s.token, { ok: "yes" }), id)).status).toBe(400);
    expect((await resultHandler(post(s.token, undefined, "{"), id)).status).toBe(400);
  });
});

describe("release download", () => {
  const get = (token: string) => new Request("http://m77.test/x", { headers: { authorization: `Bearer ${token}` } });

  it("serves the package bytes with its SHA-256", async () => {
    const s = await setup();
    const data = gzipSync(Buffer.from("pkg"));
    const meta = await releaseStore.put("1.0.0", data);
    const res = await releaseHandler(get(s.token), "1.0.0");
    expect(res.status).toBe(200);
    expect(res.headers.get("x-sha256")).toBe(meta.sha256);
    expect(Buffer.from(await res.arrayBuffer()).equals(data)).toBe(true);
  });

  it("answers 404 for unknown and malformed versions", async () => {
    const s = await setup();
    expect((await releaseHandler(get(s.token), "9.9.9")).status).toBe(404);
    expect((await releaseHandler(get(s.token), "../x")).status).toBe(404);
    expect((await releaseHandler(get(s.token), "latest")).status).toBe(404);
    const [{ n }] = await adminSql`select count(*)::int as n from agent_releases`;
    expect(n).toBe(0);
  });
});
