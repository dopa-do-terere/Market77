import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, readdir, readlink, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyUpdate, confirmBoot, extractTar } from "../../agent/update.ts";

async function makeBase() {
  const base = await mkdtemp(join(tmpdir(), "m77-base-"));
  await mkdir(join(base, "releases", "1.0.0"), { recursive: true });
  await writeFile(join(base, "releases", "1.0.0", "main.ts"), "old");
  await symlink(join("releases", "1.0.0"), join(base, "current"));
  return base;
}

async function makeTarball(files: Record<string, string>) {
  const src = await mkdtemp(join(tmpdir(), "m77-src-"));
  for (const [name, content] of Object.entries(files)) await writeFile(join(src, name), content);
  const out = join(await mkdtemp(join(tmpdir(), "m77-out-")), "r.tgz");
  execFileSync("tar", ["-czf", out, "-C", src, "."], { env: { ...process.env, COPYFILE_DISABLE: "1" } });
  const data = await readFile(out);
  return { data, sha: createHash("sha256").update(data).digest("hex") };
}

const deps = (base: string, data: Buffer) => ({
  baseDir: base,
  currentVersion: "1.0.0",
  download: async () => ({ data }),
  extract: extractTar,
  nowSeconds: () => 1000,
});
const exists = (p: string) => access(p).then(() => true, () => false);

describe("applyUpdate", () => {
  it("installs the package, writes the rollback marker and switches the symlink last", async () => {
    const base = await makeBase();
    const { data, sha } = await makeTarball({ "main.ts": "new", VERSION: "1.1.0\n" });
    const seen: string[] = [];
    const d = {
      ...deps(base, data),
      extract: async (t: string, dest: string) => {
        seen.push(`extract:${await readlink(join(base, "current"))}`);
        await extractTar(t, dest);
      },
      sync: async () => {
        seen.push(`sync:${await readlink(join(base, "current"))}:${await readFile(join(base, "pending-update"), "utf8")}`);
      },
    };
    await applyUpdate(d, "1.1.0", sha);
    expect(seen).toEqual([`extract:${join("releases", "1.0.0")}`, `sync:${join("releases", "1.0.0")}:1.0.0 1120\n`]);
    expect(await readlink(join(base, "current"))).toBe(join("releases", "1.1.0"));
    expect(await readFile(join(base, "releases", "1.1.0", "main.ts"), "utf8")).toBe("new");
    expect(await readFile(join(base, "pending-update"), "utf8")).toBe("1.0.0 1120\n");
    expect(await exists(join(base, "releases", "1.1.0", "release.tgz"))).toBe(false);
    expect((await readdir(join(base, "releases"))).sort()).toEqual(["1.0.0", "1.1.0"]);
  });

  it("changes nothing when the hash does not match", async () => {
    const base = await makeBase();
    const { data } = await makeTarball({ "main.ts": "new" });
    await expect(applyUpdate(deps(base, data), "1.1.0", "0".repeat(64))).rejects.toThrow(/sha256_mismatch/);
    expect(await readlink(join(base, "current"))).toBe(join("releases", "1.0.0"));
    expect(await readdir(join(base, "releases"))).toEqual(["1.0.0"]);
    expect(await exists(join(base, "pending-update"))).toBe(false);
  });

  it("changes nothing when the package has no main.ts", async () => {
    const base = await makeBase();
    const { data, sha } = await makeTarball({ "other.txt": "x" });
    await expect(applyUpdate(deps(base, data), "1.1.0", sha)).rejects.toThrow(/invalid_package/);
    expect(await exists(join(base, "pending-update"))).toBe(false);
    expect(await readlink(join(base, "current"))).toBe(join("releases", "1.0.0"));
    expect(await readdir(join(base, "releases"))).toEqual(["1.0.0"]);
  });

  it("changes nothing when the file is not a valid archive even with a matching hash", async () => {
    const base = await makeBase();
    const data = Buffer.from("this is not a tarball");
    const sha = createHash("sha256").update(data).digest("hex");
    await expect(applyUpdate(deps(base, data), "1.1.0", sha)).rejects.toThrow();
    expect(await exists(join(base, "pending-update"))).toBe(false);
    expect(await readlink(join(base, "current"))).toBe(join("releases", "1.0.0"));
    expect(await readdir(join(base, "releases"))).toEqual(["1.0.0"]);
  });

  it("leaves the disk as it was when sync fails", async () => {
    const base = await makeBase();
    const { data, sha } = await makeTarball({ "main.ts": "new" });
    const d = { ...deps(base, data), sync: async () => { throw new Error("sync_failed"); } };
    await expect(applyUpdate(d, "1.1.0", sha)).rejects.toThrow(/sync_failed/);
    expect(await readlink(join(base, "current"))).toBe(join("releases", "1.0.0"));
    expect((await readdir(join(base, "releases")))).toEqual(["1.0.0"]);
    expect((await readdir(base)).sort()).toEqual(["current", "releases"]);
  });

  it("refuses to update to the running version", async () => {
    const base = await makeBase();
    const { data, sha } = await makeTarball({ "main.ts": "new" });
    await expect(applyUpdate(deps(base, data), "1.0.0", sha)).rejects.toThrow(/already_current/);
    expect(await readFile(join(base, "releases", "1.0.0", "main.ts"), "utf8")).toBe("old");
  });

  it("refuses a malformed version before downloading anything", async () => {
    const base = await makeBase();
    let downloads = 0;
    const d = { ...deps(base, Buffer.alloc(0)), download: async () => (downloads++, { data: Buffer.alloc(0) }) };
    for (const v of ["../x", "1.0", "1.0.0/../../etc", "latest", ""]) {
      await expect(applyUpdate(d, v, "ab")).rejects.toThrow(/invalid_version/);
    }
    expect(downloads).toBe(0);
  });
});

describe("confirmBoot", () => {
  it("removes the marker and keeps only the current and the previous version", async () => {
    const base = await makeBase();
    await mkdir(join(base, "releases", "0.9.0"), { recursive: true });
    const { data, sha } = await makeTarball({ "main.ts": "new" });
    await applyUpdate(deps(base, data), "1.1.0", sha);
    await confirmBoot(base);
    expect(await exists(join(base, "pending-update"))).toBe(false);
    expect((await readdir(join(base, "releases"))).sort()).toEqual(["1.0.0", "1.1.0"]);
  });

  it("removes a garbage marker without pruning anything", async () => {
    const base = await makeBase();
    await mkdir(join(base, "releases", "0.9.0"), { recursive: true });
    await writeFile(join(base, "pending-update"), "garbage 1\n");
    await confirmBoot(base);
    expect(await exists(join(base, "pending-update"))).toBe(false);
    expect((await readdir(join(base, "releases"))).sort()).toEqual(["0.9.0", "1.0.0"]);
  });

  it("does nothing, and prunes nothing, when no update is pending", async () => {
    const base = await makeBase();
    await mkdir(join(base, "releases", "0.9.0"), { recursive: true });
    await confirmBoot(base);
    expect((await readdir(join(base, "releases"))).sort()).toEqual(["0.9.0", "1.0.0"]);
  });
});
