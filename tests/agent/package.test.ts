import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildAgentTarball } from "../../scripts/agent-package";

async function listing(data: Buffer) {
  const file = join(await mkdtemp(join(tmpdir(), "m77-pkg-")), "a.tgz");
  await writeFile(file, data);
  const names = execFileSync("tar", ["-tzf", file], { encoding: "utf8" }).split("\n").filter(Boolean);
  const version = execFileSync("tar", ["-xzOf", file, "./VERSION"], { encoding: "utf8" });
  return { names, version };
}

describe("agent tarball", () => {
  it("contains the agent files at the root and the version", async () => {
    const { names, version } = await listing(await buildAgentTarball("1.2.3"));
    for (const f of ["main.ts", "loop.ts", "api.ts", "browser.ts", "update.ts", "config.ts", "package.json", "install.sh", "watchdog.sh", "VERSION"]) {
      expect(names).toContain(`./${f}`);
    }
    expect(version).toBe("1.2.3\n");
    expect(names.some((n) => n.includes("node_modules") || n.includes("test"))).toBe(false);
  });

  it("is gzip and refuses a malformed version", async () => {
    const data = await buildAgentTarball("0.0.1");
    expect([data[0], data[1]]).toEqual([0x1f, 0x8b]);
    await expect(buildAgentTarball("../1.0.0")).rejects.toThrow(/invalid version/);
    await expect(buildAgentTarball("1.0")).rejects.toThrow(/invalid version/);
  });
});
