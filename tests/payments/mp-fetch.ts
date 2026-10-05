import { createHmac } from "node:crypto";

export type Call = { url: string; method: string; headers: Record<string, string>; body: unknown; signal?: boolean };
type Reply = { status?: number; json?: unknown };

/** A fetch that answers from a function and records every call. No network. */
export function fakeFetch(handler: (c: Call) => Reply) {
  const calls: Call[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
      signal: init?.signal instanceof AbortSignal,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    const r = handler(call);
    return new Response(JSON.stringify(r.json ?? {}), {
      status: r.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { f, calls };
}

/** Builds the headers Mercado Pago would send for a notification about data.id. */
export function signNotification(
  secret: string,
  o: { id: string; ts?: number; requestId?: string; secretOverride?: string },
): Headers {
  const ts = o.ts ?? Math.floor(Date.now() / 1000);
  const requestId = o.requestId ?? "req-1";
  const id = /^[a-z0-9]+$/i.test(o.id) ? o.id.toLowerCase() : o.id;
  const v1 = createHmac("sha256", o.secretOverride ?? secret)
    .update(`id:${id};request-id:${requestId};ts:${ts};`)
    .digest("hex");
  return new Headers({ "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": requestId });
}
