export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super(code);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export type Command = { id: string; type: string; version?: string; sha256?: string };

const CALL_TIMEOUT_MS = 10_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;

export function createApi(cfg: { serverUrl: string; token: string }, fetchFn: typeof fetch = fetch) {
  async function request(method: string, path: string, body: unknown, timeoutMs: number): Promise<Response> {
    const res = await fetchFn(`${cfg.serverUrl}${path}`, {
      method,
      headers: { authorization: `Bearer ${cfg.token}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: unknown };
      throw new ApiError(res.status, typeof data.error === "string" ? data.error : `http_${res.status}`);
    }
    return res;
  }

  return {
    async heartbeat(body: { agentVersion: string; pdvStatus: "running" | "stopped" }): Promise<Command | null> {
      const res = await request("POST", "/api/agent/heartbeat", body, CALL_TIMEOUT_MS);
      const data = (await res.json()) as { command: Command | null };
      return data.command ?? null;
    },
    async reportResult(id: string, ok: boolean, error?: string): Promise<void> {
      await request("POST", `/api/agent/commands/${id}/result`, { ok, error }, CALL_TIMEOUT_MS);
    },
    async downloadRelease(version: string): Promise<{ data: Buffer; sha256: string | null }> {
      const res = await request("GET", `/api/agent/releases/${version}`, undefined, DOWNLOAD_TIMEOUT_MS);
      return { data: Buffer.from(await res.arrayBuffer()), sha256: res.headers.get("x-sha256") };
    },
  };
}

export type Api = ReturnType<typeof createApi>;
