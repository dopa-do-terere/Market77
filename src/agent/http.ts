import { timingSafeEqual } from "node:crypto";
import { AppError } from "@/lib/errors";
import { errorResponse } from "@/pdv/http";
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
