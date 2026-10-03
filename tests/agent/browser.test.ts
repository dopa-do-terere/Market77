import { describe, expect, it } from "vitest";
import { type BrowserDeps, createBrowser } from "../../agent/browser.ts";

function fakeEnv() {
  type Child = { args: string[]; killed: boolean; kill(): void; on(e: "exit", cb: () => void): void; exit(): void };
  const children: Child[] = [];
  const timers: { fn: () => void; ms: number; cancelled: boolean }[] = [];
  let clock = 0;
  const deps: BrowserDeps = {
    spawn: (_cmd, args) => {
      const listeners: (() => void)[] = [];
      const c: Child = {
        args,
        killed: false,
        kill: () => {
          c.killed = true;
        },
        on: (_e, cb) => {
          listeners.push(cb);
        },
        exit: () => listeners.forEach((l) => l()),
      };
      children.push(c);
      return c;
    },
    schedule: (fn, ms) => {
      const t = { fn, ms, cancelled: false };
      timers.push(t);
      return t;
    },
    cancel: (h) => {
      (h as { cancelled: boolean }).cancelled = true;
    },
    now: () => clock,
    log: () => {},
  };
  const fire = () => {
    for (const t of timers.splice(0)) if (!t.cancelled) t.fn();
  };
  return { deps, children, timers, fire, advance: (ms: number) => (clock += ms) };
}
const opts = { command: "chromium-browser", url: "https://m77.example.com/pdv#token=T", profileDir: "/p" };

describe("browser supervisor", () => {
  it("starts once in kiosk mode on the PDV url", () => {
    const e = fakeEnv();
    const b = createBrowser(opts, e.deps);
    b.start();
    b.start();
    expect(e.children).toHaveLength(1);
    expect(e.children[0].args).toContain("--kiosk");
    expect(e.children[0].args).toContain("--user-data-dir=/p");
    expect(e.children[0].args.at(-1)).toBe(opts.url);
    expect(b.running()).toBe(true);
  });

  it("relaunches after an unexpected exit with a growing wait capped at 30 s", () => {
    const e = fakeEnv();
    const b = createBrowser(opts, e.deps);
    b.start();
    const waits: number[] = [];
    for (let i = 0; i < 8; i++) {
      e.children.at(-1)!.exit();
      expect(b.running()).toBe(false);
      waits.push(e.timers.at(-1)!.ms);
      e.fire();
      expect(b.running()).toBe(true);
    }
    expect(waits).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
  });

  it("starts the backoff over when the browser stayed up for a minute", () => {
    const e = fakeEnv();
    const b = createBrowser(opts, e.deps);
    b.start();
    e.children.at(-1)!.exit();
    e.fire();
    e.children.at(-1)!.exit();
    e.fire();
    e.advance(60_000);
    e.children.at(-1)!.exit();
    expect(e.timers.at(-1)!.ms).toBe(1000);
  });

  it("schedules one relaunch even when exit is reported twice", () => {
    const e = fakeEnv();
    const b = createBrowser(opts, e.deps);
    b.start();
    e.children[0].exit();
    e.children[0].exit();
    e.fire();
    expect(e.children).toHaveLength(2);
    expect(b.running()).toBe(true);
  });

  it("restart waits for the old process to leave, then opens a new one without a relaunch race", async () => {
    const e = fakeEnv();
    const b = createBrowser(opts, e.deps);
    b.start();
    const p = b.restart();
    expect(e.children[0].killed).toBe(true);
    e.children[0].exit();
    await p;
    expect(e.children).toHaveLength(2);
    e.fire();
    expect(e.children).toHaveLength(2);
    expect(b.running()).toBe(true);
  });

  it("restart gives up waiting after 5 s", async () => {
    const e = fakeEnv();
    const b = createBrowser(opts, e.deps);
    b.start();
    const p = b.restart();
    expect(e.timers.at(-1)!.ms).toBe(5000);
    e.fire();
    await p;
    expect(e.children).toHaveLength(2);
  });

  it("stop kills the browser and does not relaunch it", async () => {
    const e = fakeEnv();
    const b = createBrowser(opts, e.deps);
    b.start();
    const p = b.stop();
    e.children[0].exit();
    await p;
    e.fire();
    expect(e.children).toHaveLength(1);
    expect(b.running()).toBe(false);
  });

  it("two concurrent restarts end with exactly one live child", async () => {
    const e = fakeEnv();
    const b = createBrowser(opts, e.deps);
    b.start();
    const p1 = b.restart();
    const p2 = b.restart();
    e.children[0].exit();
    await p1;
    await new Promise((r) => setTimeout(r, 0));
    e.children[1].exit();
    await p2;
    expect(e.children.filter((c) => !c.killed)).toHaveLength(1);
    expect(b.running()).toBe(true);
  });

  it("stop during a pending restart leaves no live child", async () => {
    const e = fakeEnv();
    const b = createBrowser(opts, e.deps);
    b.start();
    const p1 = b.restart();
    const p2 = b.stop();
    e.children[0].exit();
    await Promise.all([p1, p2]);
    expect(e.children.filter((c) => !c.killed)).toHaveLength(0);
    expect(b.running()).toBe(false);
  });

  it("restart leaves no stray timer and the next crash backs off from 1 s", async () => {
    const e = fakeEnv();
    const b = createBrowser(opts, e.deps);
    b.start();
    const p = b.restart();
    e.children[0].exit();
    await p;
    expect(e.timers.filter((t) => !t.cancelled)).toHaveLength(0);
    e.children[1].exit();
    expect(e.timers.at(-1)!.ms).toBe(1000);
  });

  it("stop and restart cancel a pending retry timer", async () => {
    const e = fakeEnv();
    const b = createBrowser(opts, e.deps);
    b.start();
    e.children[0].exit();
    const retry = e.timers.at(-1)!;
    await b.stop();
    expect(retry.cancelled).toBe(true);
    b.start();
    e.children.at(-1)!.exit();
    const retry2 = e.timers.at(-1)!;
    await b.restart();
    expect(retry2.cancelled).toBe(true);
    expect(b.running()).toBe(true);
  });

  it("does not reset the backoff at 59999 ms of uptime", () => {
    const e = fakeEnv();
    const b = createBrowser(opts, e.deps);
    b.start();
    e.children.at(-1)!.exit();
    e.fire();
    e.advance(59_999);
    e.children.at(-1)!.exit();
    expect(e.timers.at(-1)!.ms).toBe(2000);
  });
});
