import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Packs agent/ plus a VERSION file into a gzip tarball with the files at its root. */
export async function buildAgentTarball(version: string, agentDir = "agent"): Promise<Buffer> {
  if (!/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(version)) throw new Error(`invalid version: ${version}`);
  const work = await mkdtemp(join(tmpdir(), "m77-agent-"));
  try {
    const stage = join(work, "stage");
    await cp(agentDir, stage, { recursive: true });
    await writeFile(join(stage, "VERSION"), `${version}\n`);
    const out = join(work, "agent.tgz");
    execFileSync("tar", ["-czf", out, "-C", stage, "."], { env: { ...process.env, COPYFILE_DISABLE: "1" } });
    return await readFile(out);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
