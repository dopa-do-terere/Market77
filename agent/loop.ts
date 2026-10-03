import { type Api, ApiError, type Command } from "./api.ts";

export const HEARTBEAT_MS = 30_000;
export const REVOKED_RETRY_MS = 300_000;
export const FAILURES_BEFORE_RESTART = 5;
const REPORT_TRIES = 3;
const REPORT_RETRY_MS = 2_000;
const VERSION_RE = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;

export type AgentDeps = {
  api: Pick<Api, "heartbeat" | "reportResult">;
  browser: { running(): boolean; restart(): Promise<void> };
  system: { reboot(): Promise<void>; exit(): void };
  update: { apply(version: string, sha256: string): Promise<void>; confirmBoot(): Promise<void> };
  version: string;
  sleep(ms: number): Promise<void>;
  log(message: string): void;
};

const reason = (e: unknown): string => (e instanceof Error ? e.message.slice(0, 200) : "error");

export function createAgent(d: AgentDeps): { tick(): Promise<number> } {
  let failures = 0;
  let booted = false;

  /** Tries up to three times; the server decides nothing from a missing report except to redeliver the command later. */
  async function report(id: string, ok: boolean, error?: string): Promise<boolean> {
    for (let i = 0; i < REPORT_TRIES; i++) {
      try {
        await d.api.reportResult(id, ok, error);
        return true;
      } catch {
        if (i < REPORT_TRIES - 1) await d.sleep(REPORT_RETRY_MS);
      }
    }
    return false;
  }

  async function execute(cmd: Command): Promise<void> {
    if (cmd.type === "restart_pdv") {
      try {
        await d.browser.restart();
      } catch (e) {
        await report(cmd.id, false, reason(e));
        return;
      }
      await report(cmd.id, true);
      return;
    }
    if (cmd.type === "reboot") {
      // Reboot only after the server knows the command is done; otherwise it would be redelivered after boot, in a loop.
      if (!(await report(cmd.id, true))) {
        d.log("reboot skipped: the server could not be told");
        return;
      }
      try {
        await d.system.reboot();
      } catch (e) {
        d.log(`reboot failed: ${reason(e)}`);
      }
      return;
    }
    if (cmd.type === "update") {
      if (!cmd.version || !cmd.sha256 || !VERSION_RE.test(cmd.version)) {
        await report(cmd.id, false, "invalid_update");
        return;
      }
      if (cmd.version === d.version) {
        await report(cmd.id, true);
        return;
      }
      try {
        await d.update.apply(cmd.version, cmd.sha256);
      } catch (e) {
        await report(cmd.id, false, reason(e));
        return;
      }
      await report(cmd.id, true);
      d.system.exit(); // the symlink already points at the new version; systemd starts it
      return;
    }
    await report(cmd.id, false, "unknown_command");
  }

  async function tick(): Promise<number> {
    let command: Command | null;
    try {
      command = await d.api.heartbeat({
        agentVersion: d.version,
        pdvStatus: d.browser.running() ? "running" : "stopped",
      });
    } catch (e) {
      if (e instanceof ApiError && e.code === "terminal_revoked") {
        d.log("terminal revoked: retrying in 5 minutes");
        return REVOKED_RETRY_MS;
      }
      failures += 1;
      d.log(`heartbeat failed (${failures} in a row): ${reason(e)}`);
      if (failures >= FAILURES_BEFORE_RESTART) {
        failures = 0;
        try {
          await d.browser.restart();
        } catch (err) {
          d.log(`browser restart failed: ${reason(err)}`);
        }
      }
      return HEARTBEAT_MS;
    }
    failures = 0;
    if (!booted) {
      booted = true;
      try {
        await d.update.confirmBoot();
      } catch (e) {
        d.log(`confirmBoot failed: ${reason(e)}`);
      }
    }
    if (command) {
      try {
        await execute(command);
      } catch (e) {
        d.log(`command ${command.id} failed: ${reason(e)}`);
      }
    }
    return HEARTBEAT_MS;
  }

  return { tick };
}
