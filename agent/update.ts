import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, readdir, readlink, rename, rm, symlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export const VERSION_RE = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
export const ROLLBACK_WINDOW_S = 120;

export type UpdateDeps = {
  baseDir: string;
  currentVersion: string;
  download(version: string): Promise<{ data: Buffer }>;
  extract(tarball: string, dest: string): Promise<void>;
  nowSeconds(): number;
};

export const extractTar = async (tarball: string, dest: string): Promise<void> => {
  await run("tar", ["-xzf", tarball, "-C", dest]);
};

/**
 * Installs a release next to the running one and switches the `current` symlink as the very last step.
 * Any failure before that leaves the disk as it was. The marker tells watchdog.sh to roll back if the new
 * agent does not complete a heartbeat within ROLLBACK_WINDOW_S.
 */
export async function applyUpdate(d: UpdateDeps, version: string, expectedSha256: string): Promise<void> {
  if (!VERSION_RE.test(version)) throw new Error("invalid_version");
  const { data } = await d.download(version);
  if (createHash("sha256").update(data).digest("hex") !== expectedSha256) throw new Error("sha256_mismatch");
  const dest = join(d.baseDir, "releases", version);
  const staging = `${dest}.tmp`;
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  try {
    const tarball = join(staging, "release.tgz");
    await writeFile(tarball, data);
    await d.extract(tarball, staging);
    await rm(tarball);
    await access(join(staging, "main.ts")).catch(() => {
      throw new Error("invalid_package");
    });
  } catch (e) {
    await rm(staging, { recursive: true, force: true });
    throw e;
  }
  await rm(dest, { recursive: true, force: true });
  await rename(staging, dest);
  await writeFile(join(d.baseDir, "pending-update"), `${d.currentVersion} ${d.nowSeconds() + ROLLBACK_WINDOW_S}\n`);
  const link = join(d.baseDir, "current.new");
  await rm(link, { force: true });
  await symlink(join("releases", version), link);
  await rename(link, join(d.baseDir, "current")); // atomic: replaces the old symlink
}

/** Called after the first good heartbeat: the update worked, so drop the marker and old releases. */
export async function confirmBoot(baseDir: string): Promise<void> {
  const marker = join(baseDir, "pending-update");
  let text: string;
  try {
    text = await readFile(marker, "utf8");
  } catch {
    return; // no update pending
  }
  const previous = text.trim().split(/\s+/)[0] ?? "";
  await rm(marker, { force: true });
  const current = basename(await readlink(join(baseDir, "current")));
  const keep = new Set([current, previous]);
  const releases = join(baseDir, "releases");
  for (const name of await readdir(releases)) {
    if (!keep.has(name)) await rm(join(releases, name), { recursive: true, force: true });
  }
}
