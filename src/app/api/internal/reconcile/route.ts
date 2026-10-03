import { timingSafeEqual } from "node:crypto";
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
  return Response.json({ visited: await reconcilePending() });
}
