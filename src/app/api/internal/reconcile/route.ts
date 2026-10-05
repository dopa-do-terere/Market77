import { timingSafeEqual } from "node:crypto";
import { purgeAccessEvents, syncAccessSources } from "@/domain/access";
import { processFiscalQueue } from "@/domain/fiscal";
import { reconcilePending } from "@/payments/reconcile";

/** Called by a cron (wired up in phase 3). Disabled unless RECONCILE_SECRET is set. */
export async function POST(req: Request) {
  const secret = process.env.RECONCILE_SECRET;
  if (!secret) return new Response(null, { status: 404 });
  const given = Buffer.from(req.headers.get("x-reconcile-secret") ?? "");
  const expected = Buffer.from(secret);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return new Response(null, { status: 401 });
  }
  // One queue failing must not stop the others.
  const attempt = async (label: string, fn: () => Promise<number>): Promise<number> => {
    try {
      return await fn();
    } catch (e) {
      console.error(`${label} failed`, e);
      return 0;
    }
  };
  const visited = await attempt("reconcile", () => reconcilePending());
  const fiscal = await attempt("fiscal queue", () => processFiscalQueue());
  const synced = await attempt("access sync", () => syncAccessSources());
  const purged = await attempt("access retention", () => purgeAccessEvents());
  return Response.json({ visited, fiscal, access: { synced, purged } });
}
