import { describe, expect, it } from "vitest";
import { ApiError, createApi } from "../../agent/api.ts";

type Call = { url: string; init: RequestInit };
function fakeFetch(respond: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    const call = { url, init };
    calls.push(call);
    return respond(call);
  }) as unknown as typeof fetch;
  return { fn, calls };
}
const cfg = { serverUrl: "https://m77.example.com", token: "TOKEN-TOKEN-TOKEN-TOKEN" };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe("agent api client", () => {
  it("sends the heartbeat with the bearer token and returns the command", async () => {
    const { fn, calls } = fakeFetch(() => json(200, { command: { id: "c1", type: "reboot" } }));
    const cmd = await createApi(cfg, fn).heartbeat({ agentVersion: "1.0.0", pdvStatus: "running" });
    expect(cmd).toEqual({ id: "c1", type: "reboot" });
    expect(calls[0].url).toBe("https://m77.example.com/api/agent/heartbeat");
    expect(calls[0].init.method).toBe("POST");
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe(`Bearer ${cfg.token}`);
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ agentVersion: "1.0.0", pdvStatus: "running" });
  });

  it("returns null when the server has no command", async () => {
    const { fn } = fakeFetch(() => json(200, { command: null }));
    expect(await createApi(cfg, fn).heartbeat({ agentVersion: "1.0.0", pdvStatus: "stopped" })).toBeNull();
  });

  it("throws ApiError with the status and the server error code", async () => {
    const { fn } = fakeFetch(() => json(401, { error: "terminal_revoked", message: "x" }));
    const err = await createApi(cfg, fn).heartbeat({ agentVersion: "1.0.0", pdvStatus: "running" }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect([err.status, err.code]).toEqual([401, "terminal_revoked"]);
  });

  it("uses a generic code when the error body is not JSON", async () => {
    const { fn } = fakeFetch(() => new Response("<html>bad gateway</html>", { status: 502 }));
    const err = await createApi(cfg, fn).heartbeat({ agentVersion: "1.0.0", pdvStatus: "running" }).catch((e) => e);
    expect([err.status, err.code]).toEqual([502, "http_502"]);
  });

  it("lets a network failure through as a rejection", async () => {
    const fn = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    await expect(createApi(cfg, fn).heartbeat({ agentVersion: "1.0.0", pdvStatus: "running" })).rejects.toThrow(/ECONNREFUSED/);
  });

  it("reports a command result", async () => {
    const { fn, calls } = fakeFetch(() => json(200, { ok: true }));
    await createApi(cfg, fn).reportResult("c1", false, "boom");
    expect(calls[0].url).toBe("https://m77.example.com/api/agent/commands/c1/result");
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ ok: false, error: "boom" });
  });

  it("downloads a release with its SHA-256 header", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const { fn, calls } = fakeFetch(() => new Response(bytes, { headers: { "x-sha256": "abc" } }));
    const got = await createApi(cfg, fn).downloadRelease("1.2.3");
    expect(calls[0].url).toBe("https://m77.example.com/api/agent/releases/1.2.3");
    expect([got.data.equals(Buffer.from(bytes)), got.sha256]).toEqual([true, "abc"]);
  });
});
