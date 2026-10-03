import { describe, expect, it } from "vitest";
import { ApiError, type Command } from "../../agent/api.ts";
import { FAILURES_BEFORE_RESTART, HEARTBEAT_MS, REVOKED_RETRY_MS, createAgent } from "../../agent/loop.ts";

function setup(over: { heartbeat?: () => Promise<Command | null>; reportResult?: () => Promise<void>; apply?: () => Promise<void>; running?: boolean } = {}) {
  const events: string[] = [];
  const beats: unknown[] = [];
  const agent = createAgent({
    api: {
      heartbeat: async (body) => {
        beats.push(body);
        return over.heartbeat ? over.heartbeat() : null;
      },
      reportResult: async (id, ok, error) => {
        events.push(`report:${id}:${ok}${error ? `:${error}` : ""}`);
        if (over.reportResult) await over.reportResult();
      },
    },
    browser: {
      running: () => over.running ?? true,
      restart: async () => {
        events.push("browser.restart");
      },
    },
    system: {
      reboot: async () => {
        events.push("system.reboot");
      },
      exit: () => {
        events.push("system.exit");
      },
    },
    update: {
      apply: async (v, sha) => {
        events.push(`update.apply:${v}:${sha}`);
        if (over.apply) await over.apply();
      },
      confirmBoot: async () => {
        events.push("confirmBoot");
      },
    },
    version: "1.0.0",
    sleep: async (ms) => {
      events.push(`sleep:${ms}`);
    },
    log: () => {},
  });
  return { agent, events, beats };
}
const cmd = (c: Partial<Command> & { type: string }): Command => ({ id: "c1", ...c });

describe("heartbeat loop", () => {
  it("sends its version and the PDV state and waits 30 s", async () => {
    const a = setup({ running: false });
    expect(await a.agent.tick()).toBe(HEARTBEAT_MS);
    expect(a.beats).toEqual([{ agentVersion: "1.0.0", pdvStatus: "stopped" }]);
  });

  it("restarts the browser after five failures in a row, then starts counting again", async () => {
    const a = setup({
      heartbeat: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    for (let i = 1; i < FAILURES_BEFORE_RESTART; i++) await a.agent.tick();
    expect(a.events).not.toContain("browser.restart");
    await a.agent.tick();
    expect(a.events.filter((e) => e === "browser.restart")).toHaveLength(1);
    for (let i = 1; i < FAILURES_BEFORE_RESTART; i++) await a.agent.tick();
    expect(a.events.filter((e) => e === "browser.restart")).toHaveLength(1);
    await a.agent.tick();
    expect(a.events.filter((e) => e === "browser.restart")).toHaveLength(2);
  });

  it("does not count failures that a success interrupts", async () => {
    let n = 0;
    const a = setup({
      heartbeat: async () => {
        n += 1;
        if (n % 3 === 0) return null;
        throw new Error("down");
      },
    });
    for (let i = 0; i < 12; i++) await a.agent.tick();
    expect(a.events).not.toContain("browser.restart");
  });

  it("backs off for five minutes when the terminal was revoked and never reboots the machine on its own", async () => {
    const a = setup({
      heartbeat: async () => {
        throw new ApiError(401, "terminal_revoked");
      },
    });
    for (let i = 0; i < 10; i++) expect(await a.agent.tick()).toBe(REVOKED_RETRY_MS);
    expect(a.events).toEqual([]);
  });

  it("confirms a finished update on the first good heartbeat only", async () => {
    const a = setup();
    await a.agent.tick();
    await a.agent.tick();
    expect(a.events.filter((e) => e === "confirmBoot")).toHaveLength(1);
  });

  it("keeps the normal wait after running a command", async () => {
    const a = setup({ heartbeat: async () => cmd({ type: "restart_pdv" }) });
    await expect(a.agent.tick()).resolves.toBe(HEARTBEAT_MS);
  });
});

describe("commands", () => {
  it("restart_pdv restarts the browser and then reports success", async () => {
    const a = setup({ heartbeat: async () => cmd({ type: "restart_pdv" }) });
    await a.agent.tick();
    expect(a.events.filter((e) => e !== "confirmBoot")).toEqual(["browser.restart", "report:c1:true"]);
  });

  it("reboot reports success first and only then reboots", async () => {
    const a = setup({ heartbeat: async () => cmd({ type: "reboot" }) });
    await a.agent.tick();
    expect(a.events.filter((e) => e !== "confirmBoot")).toEqual(["report:c1:true", "system.reboot"]);
  });

  it("reboot retries the confirmation and never reboots when it cannot be confirmed", async () => {
    const a = setup({
      heartbeat: async () => cmd({ type: "reboot" }),
      reportResult: async () => {
        throw new Error("network");
      },
    });
    await a.agent.tick();
    expect(a.events).not.toContain("system.reboot");
    expect(a.events.filter((e) => e.startsWith("report:"))).toHaveLength(3);
    expect(a.events.filter((e) => e.startsWith("sleep:"))).toEqual(["sleep:2000", "sleep:2000"]);
  });

  it("reboot works when the second confirmation attempt succeeds", async () => {
    let tries = 0;
    const a = setup({
      heartbeat: async () => cmd({ type: "reboot" }),
      reportResult: async () => {
        tries += 1;
        if (tries === 1) throw new Error("blip");
      },
    });
    await a.agent.tick();
    expect(a.events).toContain("system.reboot");
  });

  it("update applies the package, reports success and then exits so systemd starts the new version", async () => {
    const a = setup({ heartbeat: async () => cmd({ type: "update", version: "1.1.0", sha256: "ab" }) });
    await a.agent.tick();
    expect(a.events.filter((e) => e !== "confirmBoot")).toEqual(["update.apply:1.1.0:ab", "report:c1:true", "system.exit"]);
  });

  it("update still exits when the success report cannot be delivered, because the package is already switched", async () => {
    const a = setup({
      heartbeat: async () => cmd({ type: "update", version: "1.1.0", sha256: "ab" }),
      reportResult: async () => {
        throw new Error("network");
      },
    });
    await a.agent.tick();
    expect(a.events).toContain("system.exit");
  });

  it("update to the version already running just reports success", async () => {
    const a = setup({ heartbeat: async () => cmd({ type: "update", version: "1.0.0", sha256: "ab" }) });
    await a.agent.tick();
    expect(a.events.filter((e) => e !== "confirmBoot")).toEqual(["report:c1:true"]);
  });

  it("update that fails reports the error and does not exit", async () => {
    const a = setup({
      heartbeat: async () => cmd({ type: "update", version: "1.1.0", sha256: "ab" }),
      apply: async () => {
        throw new Error("sha256_mismatch");
      },
    });
    await a.agent.tick();
    expect(a.events.filter((e) => e !== "confirmBoot")).toEqual(["update.apply:1.1.0:ab", "report:c1:false:sha256_mismatch"]);
  });

  it("update without a version or hash fails without touching the disk", async () => {
    const a = setup({ heartbeat: async () => cmd({ type: "update" }) });
    await a.agent.tick();
    expect(a.events.filter((e) => e !== "confirmBoot")).toEqual(["report:c1:false:invalid_update"]);
  });

  it("an unknown command type is reported as failed and nothing runs", async () => {
    const a = setup({ heartbeat: async () => cmd({ type: "rm_rf" }) });
    await a.agent.tick();
    expect(a.events.filter((e) => e !== "confirmBoot")).toEqual(["report:c1:false:unknown_command"]);
  });

  it("restart_pdv that throws reports the failure", async () => {
    const events: string[] = [];
    const agent = createAgent({
      api: {
        heartbeat: async () => cmd({ type: "restart_pdv" }),
        reportResult: async (id, ok, error) => {
          events.push(`report:${id}:${ok}:${error}`);
        },
      },
      browser: {
        running: () => true,
        restart: async () => {
          throw new Error("chromium_missing");
        },
      },
      system: { reboot: async () => {}, exit: () => {} },
      update: { apply: async () => {}, confirmBoot: async () => {} },
      version: "1.0.0",
      sleep: async () => {},
      log: () => {},
    });
    await agent.tick();
    expect(events).toEqual(["report:c1:false:chromium_missing"]);
  });
});
