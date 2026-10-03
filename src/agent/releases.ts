import { createHash } from "node:crypto";
import { adminSql } from "@/db/client";
import { VERSION_RE } from "@/domain/agent";
import { AppError } from "@/lib/errors";

export const MAX_RELEASE_BYTES = 20 * 1024 * 1024;

export type ReleaseMeta = { version: string; sha256: string; sizeBytes: number; createdAt: Date };

/** Where agent packages live. Phase 3 keeps them in Postgres; swap `releaseStore` for an object store if packages grow. */
export interface ReleaseStore {
  put(version: string, data: Buffer): Promise<ReleaseMeta>;
  get(version: string): Promise<{ meta: ReleaseMeta; data: Buffer } | null>;
  meta(version: string): Promise<ReleaseMeta | null>;
  latest(): Promise<ReleaseMeta | null>;
}

const toMeta = (r: Record<string, unknown>): ReleaseMeta => ({
  version: r.version as string,
  sha256: r.sha256 as string,
  sizeBytes: r.size_bytes as number,
  createdAt: r.created_at as Date,
});

export const pgReleaseStore: ReleaseStore = {
  async put(version, data) {
    if (!VERSION_RE.test(version)) throw new AppError("invalid_input");
    if (data.length < 2 || data[0] !== 0x1f || data[1] !== 0x8b) throw new AppError("invalid_input");
    if (data.length > MAX_RELEASE_BYTES) throw new AppError("release_too_large");
    const sha256 = createHash("sha256").update(data).digest("hex");
    const rows = await adminSql`
      insert into agent_releases (version, sha256, size_bytes, data)
      values (${version}, ${sha256}, ${data.length}, ${data})
      on conflict (version) do nothing
      returning version, sha256, size_bytes, created_at`;
    if (rows.length === 0) throw new AppError("release_exists");
    return toMeta(rows[0]);
  },
  async get(version) {
    if (!VERSION_RE.test(version)) return null;
    const [r] = await adminSql`
      select version, sha256, size_bytes, created_at, data from agent_releases where version = ${version}`;
    return r ? { meta: toMeta(r), data: Buffer.from(r.data as Buffer) } : null;
  },
  async meta(version) {
    if (!VERSION_RE.test(version)) return null;
    const [r] = await adminSql`
      select version, sha256, size_bytes, created_at from agent_releases where version = ${version}`;
    return r ? toMeta(r) : null;
  },
  async latest() {
    const [r] = await adminSql`
      select version, sha256, size_bytes, created_at from agent_releases order by created_at desc limit 1`;
    return r ? toMeta(r) : null;
  },
};

export const releaseStore: ReleaseStore = pgReleaseStore;
