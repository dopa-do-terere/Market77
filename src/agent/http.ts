import { timingSafeEqual } from "node:crypto";
import { withOrg } from "@/db/tenant";
import { claimNextCommand, finishCommand, recordHeartbeat } from "@/domain/agent";
import { AppError } from "@/lib/errors";
import { requireTerminal } from "@/pdv/auth";
import { bodyOf, errorResponse, handle } from "@/pdv/http";
import { MAX_RELEASE_BYTES, releaseStore } from "./releases";

function secretMatches(given: string | null, expected: string): boolean {
  const a = Buffer.from(given ?? "");
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Called by `npm run agent:release`. Disabled unless RELEASE_SECRET is set. */
export async function publishReleaseHandler(req: Request): Promise<Response> {
  const secret = process.env.RELEASE_SECRET;
  if (!secret) return new Response(null, { status: 404 });
  if (!secretMatches(req.headers.get("x-release-secret"), secret)) return new Response(null, { status: 401 });
  try {
    if (Number(req.headers.get("content-length") ?? 0) > MAX_RELEASE_BYTES) throw new AppError("release_too_large");
    const data = Buffer.from(await req.arrayBuffer());
    const meta = await releaseStore.put(req.headers.get("x-version") ?? "", data);
    return Response.json({ version: meta.version, sha256: meta.sha256, sizeBytes: meta.sizeBytes }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * The agent calls this every 30 s. The heartbeat and the claim share one transaction: the terminal row lock
 * taken by the heartbeat update makes simultaneous heartbeats of one terminal take turns.
 */
export const heartbeatHandler = (req: Request, now: Date = new Date()) =>
  handle(req, async (t) => {
    const raw = await bodyOf(req);
    const claimed = await withOrg(t.orgId, async (tx) => {
      await recordHeartbeat(tx, t.terminalId, raw, now);
      return claimNextCommand(tx, t.terminalId, now);
    });
    if (!claimed) return { command: null };
    if (claimed.type !== "update") return { command: { id: claimed.id, type: claimed.type } };
    const meta = await releaseStore.meta(claimed.payload.version ?? "");
    if (!meta) {
      await withOrg(t.orgId, (tx) =>
        finishCommand(tx, t.terminalId, claimed.id, { ok: false, error: "release_not_found" }, now),
      );
      return { command: null };
    }
    return { command: { id: claimed.id, type: claimed.type, version: meta.version, sha256: meta.sha256 } };
  });

export const resultHandler = (req: Request, commandId: string, now: Date = new Date()) =>
  handle(req, async (t) => {
    const raw = await bodyOf(req);
    await withOrg(t.orgId, (tx) => finishCommand(tx, t.terminalId, commandId, raw, now));
    return { ok: true };
  });

export async function releaseHandler(req: Request, version: string): Promise<Response> {
  try {
    await requireTerminal(req);
    const found = await releaseStore.get(version);
    if (!found) throw new AppError("release_not_found");
    return new Response(new Uint8Array(found.data), {
      headers: { "content-type": "application/gzip", "x-sha256": found.meta.sha256 },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
