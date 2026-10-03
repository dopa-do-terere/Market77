import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const [major, minor] = process.versions.node.split(".").map(Number);
const stripsTypes = major > 22 || (major === 22 && minor >= 18);

describe("agent scripts", () => {
  it.skipIf(!stripsTypes)("loads under Node's type stripping (no build step on the totem)", () => {
    const r = spawnSync(process.execPath, ["agent/main.ts", "--check"], { encoding: "utf8" });
    expect([r.status, r.stdout.trim()]).toEqual([0, "ok"]);
  });

  it("has valid bash syntax", () => {
    for (const f of ["agent/install.sh", "agent/watchdog.sh"]) {
      const r = spawnSync("bash", ["-n", f], { encoding: "utf8" });
      expect([f, r.status, r.stderr]).toEqual([f, 0, ""]);
    }
  });

  const install = (...args: string[]) => spawnSync("bash", ["agent/install.sh", ...args], { encoding: "utf8" });
  const TOKEN = "YICrAdoFbgBTwO0isQT3ZfdQ_zgnKqNluOiuLwVXQXM";

  it("refuses missing arguments, a plain http server and a malformed token before touching the system", () => {
    expect([install().status, install().stderr]).toEqual([1, expect.stringMatching(/usage/)]);
    const http = install("http://x.com", TOKEN);
    expect([http.status, http.stderr]).toEqual([1, expect.stringMatching(/https/)]);
    const short = install("https://x.com", "short");
    expect([short.status, short.stderr]).toEqual([1, expect.stringMatching(/token/)]);
  });

  it.skipIf(process.getuid?.() === 0)("refuses to run without root", () => {
    const r = install("https://x.com", TOKEN);
    expect([r.status, r.stderr]).toEqual([1, expect.stringMatching(/root/)]);
  });

  it("agent:release refuses a plain http server before building or sending anything", () => {
    const r = spawnSync("npx", ["tsx", "scripts/agent-release.ts", "1.0.0", "http://example.com"], {
      encoding: "utf8",
      env: { ...process.env, RELEASE_SECRET: "x" },
    });
    expect([r.status, r.stderr]).toEqual([1, expect.stringMatching(/https/)]);
  });
});
