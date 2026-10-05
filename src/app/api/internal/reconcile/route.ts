import { timingSafeEqual } from "node:crypto";
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
  // One queue failing must not stop the other.
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
  return Response.json({ visited, fiscal });
}
