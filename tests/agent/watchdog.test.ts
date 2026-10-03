import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, readlink, symlink, writeFile } from "node:fs/promises";
import { access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const WATCHDOG = resolve("agent/watchdog.sh");
const exists = (p: string) => access(p).then(() => true, () => false);

async function setup(marker?: string) {
  const base = await mkdtemp(join(tmpdir(), "m77-wd-"));
  for (const v of ["1.0.0", "1.1.0"]) await mkdir(join(base, "releases", v), { recursive: true });
  await symlink(join("releases", "1.1.0"), join(base, "current"));
  const fake = join(base, "fake-systemctl.sh");
  await writeFile(fake, `#!/bin/sh\necho "$@" >> "${base}/calls"\n`);
  await chmod(fake, 0o755);
  if (marker !== undefined) await writeFile(join(base, "pending-update"), marker);
  const run = () => spawnSync("bash", [WATCHDOG], { env: { ...process.env, M77_BASE: base, M77_SYSTEMCTL: fake } });
  const calls = async () => ((await exists(join(base, "calls"))) ? readFile(join(base, "calls"), "utf8") : "");
  return { base, run, calls };
}

describe("watchdog", () => {
  it("does nothing without a marker", async () => {
    const s = await setup();
    expect(s.run().status).toBe(0);
    expect(await readlink(join(s.base, "current"))).toBe(join("releases", "1.1.0"));
    expect(await s.calls()).toBe("");
  });

  it("does nothing before the deadline and keeps the marker", async () => {
    const s = await setup("1.0.0 99999999999\n");
    expect(s.run().status).toBe(0);
    expect(await readlink(join(s.base, "current"))).toBe(join("releases", "1.1.0"));
    expect(await exists(join(s.base, "pending-update"))).toBe(true);
    expect(await s.calls()).toBe("");
  });

  it("rolls back to the previous version after the deadline and restarts the agent", async () => {
    const s = await setup("1.0.0 1\n");
    expect(s.run().status).toBe(0);
    expect(await readlink(join(s.base, "current"))).toBe(join("releases", "1.0.0"));
    expect(await exists(join(s.base, "pending-update"))).toBe(false);
    expect(await s.calls()).toBe("restart market77-agent\n");
  });

  it("drops a marker with a malformed version without touching anything", async () => {
    const s = await setup("../../etc 1\n");
    expect(s.run().status).toBe(0);
    expect(await readlink(join(s.base, "current"))).toBe(join("releases", "1.1.0"));
    expect(await exists(join(s.base, "pending-update"))).toBe(false);
    expect(await s.calls()).toBe("");
  });

  it("drops a marker whose previous version is gone", async () => {
    const s = await setup("0.0.1 1\n");
    expect(s.run().status).toBe(0);
    expect(await readlink(join(s.base, "current"))).toBe(join("releases", "1.1.0"));
    expect(await exists(join(s.base, "pending-update"))).toBe(false);
    expect(await s.calls()).toBe("");
  });

  it("drops a marker with a malformed deadline", async () => {
    const s = await setup("1.0.0 soon\n");
    expect(s.run().status).toBe(0);
    expect(await exists(join(s.base, "pending-update"))).toBe(false);
    expect(await readlink(join(s.base, "current"))).toBe(join("releases", "1.1.0"));
  });
});
