import { beforeEach, describe, expect, it } from "vitest";
import { appSql } from "@/db/client";
import { withOrg } from "@/db/tenant";
import { makeOrg, resetDb, seedStore } from "../helpers";

beforeEach(resetDb);

const insertCommand = (orgId: string, terminalId: string, type = "restart_pdv") =>
  withOrg(orgId, (tx) => tx`
    insert into terminal_commands (org_id, terminal_id, type)
    values (${orgId}, ${terminalId}, ${type}) returning id`);

describe("phase 3 schema", () => {
  it("isolates terminal commands per tenant", async () => {
    const a = await makeOrg("A");
    const b = await makeOrg("B");
    const sa = await seedStore(a);
    const sb = await seedStore(b);
    await insertCommand(a, sa.terminalId);
    await insertCommand(b, sb.terminalId);
    const seen = await withOrg(a, (tx) => tx`select terminal_id from terminal_commands`);
    expect(seen.map((r) => r.terminal_id)).toEqual([sa.terminalId]);
  });

  it("blocks a command that points at another tenant's terminal", async () => {
    const a = await makeOrg("A");
    const b = await makeOrg("B");
    const theirs = await seedStore(b);
    await expect(insertCommand(a, theirs.terminalId)).rejects.toThrow(/foreign key|row-level security/);
  });

  it("allows one open command per type per terminal, and a new one after it finishes", async () => {
    const a = await makeOrg("A");
    const s = await seedStore(a);
    const [first] = await insertCommand(a, s.terminalId);
    await expect(insertCommand(a, s.terminalId)).rejects.toThrow(/unique|duplicate/);
    await insertCommand(a, s.terminalId, "reboot");
    await withOrg(a, (tx) => tx`update terminal_commands set status = 'succeeded' where id = ${first.id}`);
    await expect(insertCommand(a, s.terminalId)).resolves.toBeDefined();
  });

  it("rejects unknown command types and statuses", async () => {
    const a = await makeOrg("A");
    const s = await seedStore(a);
    await expect(insertCommand(a, s.terminalId, "rm_rf")).rejects.toThrow(/check/);
  });

  it("keeps agent_releases away from the application role", async () => {
    await expect(appSql`select version from agent_releases`).rejects.toThrow(/permission denied/);
  });
});
