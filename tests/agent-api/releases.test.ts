import { gzipSync } from "node:zlib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_RELEASE_BYTES, releaseStore } from "@/agent/releases";
import { publishReleaseHandler } from "@/agent/http";
import { codeOf, resetDb } from "../helpers";

beforeEach(resetDb);

const pkg = (text = "agent") => gzipSync(Buffer.from(text));

describe("release store", () => {
  it("stores a package, returns its hash and reads it back byte for byte", async () => {
    const data = pkg("v1");
    const meta = await releaseStore.put("1.0.0", data);
    expect(meta.sha256).toMatch(/^[0-9a-f]{64}$/);
    const got = await releaseStore.get("1.0.0");
    expect(got?.data.equals(data)).toBe(true);
    expect(got?.meta.sizeBytes).toBe(data.length);
  });

  it("refuses a repeated version, bad versions, non-gzip data and oversized data", async () => {
    await releaseStore.put("1.0.0", pkg());
    expect(await codeOf(releaseStore.put("1.0.0", pkg("other")))).toBe("release_exists");
    for (const v of ["", "1.0", "../1.0.0", "1.0.0-beta", "latest"]) {
      expect(await codeOf(releaseStore.put(v, pkg()))).toBe("invalid_input");
    }
    expect(await codeOf(releaseStore.put("1.0.1", Buffer.from("not gzip")))).toBe("invalid_input");
    const big = Buffer.alloc(MAX_RELEASE_BYTES + 1);
    big[0] = 0x1f;
    big[1] = 0x8b;
    expect(await codeOf(releaseStore.put("1.0.2", big))).toBe("release_too_large");
  });

  it("returns null for unknown versions and the most recently published one as latest", async () => {
    expect(await releaseStore.get("9.9.9")).toBeNull();
    expect(await releaseStore.latest()).toBeNull();
    await releaseStore.put("1.0.0", pkg("a"));
    await releaseStore.put("0.9.0", pkg("b"));
    expect((await releaseStore.latest())?.version).toBe("0.9.0");
  });
});

describe("publish route handler", () => {
  const call = (secret: string | undefined, version: string | undefined, body: Buffer) =>
    publishReleaseHandler(
      new Request("http://m77.test/api/internal/releases", {
        method: "POST",
        headers: {
          ...(secret ? { "x-release-secret": secret } : {}),
          ...(version ? { "x-version": version } : {}),
        },
        body: new Uint8Array(body),
      }),
    );

  it("is a 404 without a configured secret, 401 with a wrong one and 201 with the right one", async () => {
    vi.stubEnv("RELEASE_SECRET", "");
    expect((await call("x", "1.0.0", pkg())).status).toBe(404);
    vi.unstubAllEnvs();
    expect((await call(undefined, "1.0.0", pkg())).status).toBe(401);
    expect((await call("wrong", "1.0.0", pkg())).status).toBe(401);
    const ok = await call("test-release-secret", "1.0.0", pkg());
    expect(ok.status).toBe(201);
    expect(Object.keys(await ok.json()).sort()).toEqual(["sha256", "sizeBytes", "version"]);
  });

  it("answers 409 for a repeated version, 400 for a bad one and 413 for an oversized body", async () => {
    await call("test-release-secret", "1.0.0", pkg());
    expect((await call("test-release-secret", "1.0.0", pkg("x"))).status).toBe(409);
    expect((await call("test-release-secret", "oops", pkg())).status).toBe(400);
    expect((await call("test-release-secret", undefined, pkg())).status).toBe(400);
    const big = Buffer.alloc(MAX_RELEASE_BYTES + 1);
    big[0] = 0x1f;
    big[1] = 0x8b;
    expect((await call("test-release-secret", "1.0.5", big)).status).toBe(413);
  });
});
