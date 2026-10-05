import { createHmac, timingSafeEqual } from "node:crypto";
import type { MercadoPagoCredentials } from "@/domain/credentials";

export const MP_API = "https://api.mercadopago.com";
export type Fetch = typeof fetch;

/** Carries the HTTP status only: the response body may hold payer data and must never reach a log or a client. */
export class MercadoPagoError extends Error {
  constructor(readonly status: number) {
    super(`mercadopago http ${status}`);
    this.name = "MercadoPagoError";
  }
}

export async function mpCall(
  creds: MercadoPagoCredentials,
  f: Fetch,
  method: "GET" | "POST",
  path: string,
  o: { body?: unknown; idempotencyKey?: string } = {},
): Promise<unknown> {
  const res = await f(`${MP_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${creds.accessToken}`,
      "Content-Type": "application/json",
      ...(o.idempotencyKey ? { "X-Idempotency-Key": o.idempotencyKey } : {}),
    },
    body: o.body === undefined ? undefined : JSON.stringify(o.body),
  });
  if (!res.ok) throw new MercadoPagoError(res.status);
  return res.json();
}

export type Notification = { kind: "payment" | "order"; id: string };

const MAX_SKEW_MS = 5 * 60_000;

/**
 * Validates x-signature (HMAC-SHA256 of "id:<data.id>;request-id:<x-request-id>;ts:<ts>;") and says what changed.
 * Throws when the signature or the timestamp is not valid; null for a topic we do not use.
 * The notification only says "this id changed": the state always comes from the API.
 */
export function verifyNotification(
  secret: string,
  headers: Headers,
  rawBody: string,
  url: URL,
  now: Date,
): Notification | null {
  let body: { type?: unknown; data?: { id?: unknown } };
  try {
    body = JSON.parse(rawBody);
  } catch {
    throw new Error("invalid body");
  }
  const rawId = url.searchParams.get("data.id") ?? body?.data?.id;
  const id = rawId === undefined || rawId === null ? "" : String(rawId);
  const parts = new Map(
    (headers.get("x-signature") ?? "").split(",").map((p) => {
      const i = p.indexOf("=");
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()] as const;
    }),
  );
  const ts = parts.get("ts");
  const v1 = parts.get("v1");
  if (!ts || !v1 || !id) throw new Error("invalid signature");
  const manifestId = /^[a-z0-9]+$/i.test(id) ? id.toLowerCase() : id;
  const manifest = `id:${manifestId};request-id:${headers.get("x-request-id") ?? ""};ts:${ts};`;
  const want = createHmac("sha256", secret).update(manifest).digest();
  const given = Buffer.from(v1, "hex");
  if (given.length !== want.length || !timingSafeEqual(given, want)) throw new Error("invalid signature");
  const n = Number(ts);
  const sentAt = n > 1e12 ? n : n * 1000; // seconds or milliseconds
  if (!Number.isFinite(sentAt) || Math.abs(now.getTime() - sentAt) > MAX_SKEW_MS) throw new Error("stale signature");
  if (body.type === "payment") return { kind: "payment", id };
  if (body.type === "order") return { kind: "order", id };
  return null;
}
