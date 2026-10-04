import { z } from "zod";
import { setFakeFiscalMode } from "@/fiscal/fake-fiscal";

const Body = z.object({ mode: z.enum(["ok", "down", "reject", "lost"]) });

/** Dev only: switches the simulated fiscal provider between ok, down, reject and lost. */
export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") return new Response(null, { status: 404 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_input" }, { status: 400 });
  setFakeFiscalMode(parsed.data.mode);
  return Response.json({ mode: parsed.data.mode });
}
