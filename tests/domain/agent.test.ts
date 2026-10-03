import { beforeEach, describe, expect, it } from "vitest";
import { adminSql } from "@/db/client";
import { withOrg } from "@/db/tenant";
import {
  COMMAND_TTL_MS, ONLINE_WINDOW_MS, REDELIVER_AFTER_MS, claimNextCommand, countOfflineTerminals,
  createCommand, finishCommand, isOnline, listCommands, recordHeartbeat,
} from "@/domain/agent";
import { createTerminal, listTerminals, revokeTerminal } from "@/domain/terminals";
import { codeOf, makeOrg, makeUser, resetDb, seedStore } from "../helpers";

beforeEach(resetDb);

const at = (ms: number) => new Date(Date.now() + ms);

async function setup() {
  const orgId = await makeOrg("A");
  const userId = await makeUser(`u${Math.random()}@x.com`);
  const { marketId } = await seedStore(orgId);
  const { id: terminalId } = await withOrg(orgId, (tx) =>
    createTerminal(tx, orgId, { marketId, name: "Totem 1" }),
  );
  const send = (type: string, version?: string) =>
    withOrg(orgId, (tx) => createCommand(tx, orgId, userId, { terminalId, type, version }, new Date()));
  const claim = (now = new Date()) => withOrg(orgId, (tx) => claimNextCommand(tx, terminalId, now));
  return { orgId, userId, marketId, terminalId, send, claim };
}

describe("heartbeat and online state", () => {
  it("stores the heartbeat and shows it in the terminal list", async () => {
    const s = await setup();
    const now = new Date();
    await withOrg(s.orgId, (tx) =>
      recordHeartbeat(tx, s.terminalId, { agentVersion: "1.0.0", pdvStatus: "running" }, now),
    );
    const [t] = await withOrg(s.orgId, (tx) => listTerminals(tx));
    expect([t.agentVersion, t.pdvStatus, t.lastHeartbeatAt?.getTime()]).toEqual(["1.0.0", "running", now.getTime()]);
    expect(t.timezone).toBeTruthy();
  });

  it("rejects a bad heartbeat body", async () => {
    const s = await setup();
    const bad = [{}, { agentVersion: "", pdvStatus: "running" }, { agentVersion: "1.0.0", pdvStatus: "weird" }, null];
    for (const raw of bad) {
      expect(await codeOf(withOrg(s.orgId, (tx) => recordHeartbeat(tx, s.terminalId, raw, new Date())))).toBe("invalid_input");
    }
  });

  it("is online up to 2 minutes after the last heartbeat and never connected is not online", () => {
    const now = new Date("2026-10-03T12:00:00Z");
    expect(isOnline(null, now)).toBe(false);
    expect(isOnline(new Date(now.getTime() - ONLINE_WINDOW_MS), now)).toBe(true);
    expect(isOnline(new Date(now.getTime() - ONLINE_WINDOW_MS - 1), now)).toBe(false);
  });

  it("counts only terminals that connected before and went quiet, ignoring revoked ones", async () => {
    const s = await setup();
    const now = new Date();
    const mk = (name: string) =>
      withOrg(s.orgId, (tx) => createTerminal(tx, s.orgId, { marketId: s.marketId, name }));
    const quiet = await mk("Quieto");
    const live = await mk("Vivo");
    const gone = await mk("Revogado");
    await mk("Nunca");
    const beat = (id: string, when: Date) =>
      withOrg(s.orgId, (tx) => recordHeartbeat(tx, id, { agentVersion: "1.0.0", pdvStatus: "running" }, when));
    await beat(quiet.id, new Date(now.getTime() - ONLINE_WINDOW_MS - 1000));
    await beat(live.id, now);
    await beat(gone.id, new Date(now.getTime() - ONLINE_WINDOW_MS - 1000));
    await withOrg(s.orgId, (tx) => revokeTerminal(tx, gone.id));
    expect(await withOrg(s.orgId, (tx) => countOfflineTerminals(tx, now))).toBe(1);
  });
});

describe("command delivery", () => {
  it("delivers the oldest pending command once and nothing else while it waits for a result", async () => {
    const s = await setup();
    await s.send("restart_pdv");
    await s.send("reboot");
    const first = await s.claim();
    expect(first?.type).toBe("restart_pdv");
    expect(await s.claim()).toBeNull();
    expect(await s.claim(at(REDELIVER_AFTER_MS - 5000))).toBeNull();
  });

  it("redelivers a delivered command that got no result after 2 minutes", async () => {
    const s = await setup();
    await s.send("reboot");
    const first = await s.claim();
    const again = await s.claim(at(REDELIVER_AFTER_MS + 5000));
    expect(again?.id).toBe(first?.id);
  });

  it("serves the next command after the first one finishes", async () => {
    const s = await setup();
    await s.send("restart_pdv");
    await s.send("reboot");
    const first = await s.claim();
    await withOrg(s.orgId, (tx) => finishCommand(tx, s.terminalId, first!.id, { ok: true }, new Date()));
    expect((await s.claim())?.type).toBe("reboot");
  });

  it("delivers to exactly one of several simultaneous heartbeats", async () => {
    const s = await setup();
    await s.send("reboot");
    const beat = () =>
      withOrg(s.orgId, async (tx) => {
        const now = new Date();
        await recordHeartbeat(tx, s.terminalId, { agentVersion: "1.0.0", pdvStatus: "running" }, now);
        return claimNextCommand(tx, s.terminalId, now);
      });
    const got = await Promise.all([beat(), beat(), beat(), beat(), beat()]);
    expect(got.filter((c) => c !== null)).toHaveLength(1);
  });

  it("expires old commands instead of delivering them", async () => {
    const s = await setup();
    const [row] = await withOrg(s.orgId, (tx) => tx`
      insert into terminal_commands (org_id, terminal_id, type, created_at)
      values (${s.orgId}, ${s.terminalId}, 'reboot', now() - interval '11 minutes') returning id`);
    expect(await s.claim()).toBeNull();
    const [after] = await adminSql`select status, error from terminal_commands where id = ${row.id}`;
    expect([after.status, after.error]).toEqual(["failed", "expired"]);
    expect(COMMAND_TTL_MS).toBe(600_000);
  });

  it("carries the version of an update in the payload", async () => {
    const s = await setup();
    await s.send("update", "1.2.3");
    expect((await s.claim())?.payload).toEqual({ version: "1.2.3" });
  });
});

describe("command results", () => {
  it("closes a delivered command, is idempotent and keeps the first outcome", async () => {
    const s = await setup();
    await s.send("restart_pdv");
    const cmd = await s.claim();
    const finish = (raw: unknown) =>
      withOrg(s.orgId, (tx) => finishCommand(tx, s.terminalId, cmd!.id, raw, new Date()));
    await finish({ ok: false, error: "chromium_failed" });
    await finish({ ok: true });
    const [row] = await withOrg(s.orgId, (tx) => listCommands(tx, s.terminalId));
    expect([row.status, row.error]).toEqual(["failed", "chromium_failed"]);
  });

  it("answers not_found for another terminal's command and for malformed ids", async () => {
    const s = await setup();
    const other = await withOrg(s.orgId, (tx) =>
      createTerminal(tx, s.orgId, { marketId: s.marketId, name: "Outro" }),
    );
    await s.send("reboot");
    const cmd = await s.claim();
    const fin = (terminalId: string, id: string) =>
      withOrg(s.orgId, (tx) => finishCommand(tx, terminalId, id, { ok: true }, new Date()));
    expect(await codeOf(fin(other.id, cmd!.id))).toBe("not_found");
    expect(await codeOf(fin(s.terminalId, "nope"))).toBe("not_found");
    expect(await codeOf(withOrg(s.orgId, (tx) => finishCommand(tx, s.terminalId, cmd!.id, { ok: "yes" }, new Date())))).toBe("invalid_input");
  });
});

describe("creating commands", () => {
  it("refuses a second open command of the same type and accepts it after expiry", async () => {
    const s = await setup();
    await s.send("reboot");
    expect(await codeOf(s.send("reboot"))).toBe("command_in_progress");
    await s.send("restart_pdv");
    await adminSql`update terminal_commands set created_at = now() - interval '11 minutes' where type = 'reboot'`;
    await expect(s.send("reboot")).resolves.toBeDefined();
  });

  it("validates input, the terminal and the update version", async () => {
    const s = await setup();
    expect(await codeOf(s.send("format_disk"))).toBe("invalid_input");
    expect(await codeOf(s.send("update"))).toBe("invalid_input");
    expect(await codeOf(s.send("update", "../etc"))).toBe("invalid_input");
    const bad = (terminalId: string) =>
      withOrg(s.orgId, (tx) => createCommand(tx, s.orgId, s.userId, { terminalId, type: "reboot" }, new Date()));
    expect(await codeOf(bad("nope"))).toBe("invalid_input");
    expect(await codeOf(bad("00000000-0000-0000-0000-000000000000"))).toBe("not_found");
    await withOrg(s.orgId, (tx) => revokeTerminal(tx, s.terminalId));
    expect(await codeOf(s.send("reboot"))).toBe("terminal_revoked");
  });

  it("does not let tenant B command tenant A's terminal", async () => {
    const a = await setup();
    const orgB = await makeOrg("B");
    const code = await codeOf(
      withOrg(orgB, (tx) =>
        createCommand(tx, orgB, a.userId, { terminalId: a.terminalId, type: "reboot" }, new Date())),
    );
    expect(code).toBe("not_found");
  });

  it("lists the latest commands first and caps the list", async () => {
    const s = await setup();
    await s.send("restart_pdv");
    await s.send("reboot");
    const list = await withOrg(s.orgId, (tx) => listCommands(tx, s.terminalId, 1));
    expect(list.map((c) => c.type)).toEqual(["reboot"]);
  });
});
