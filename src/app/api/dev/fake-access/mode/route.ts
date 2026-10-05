import { z } from "zod";
import { setFakeAccessMode } from "@/access/fake-access";

const Body = z.object({ mode: z.enum(["ok", "down"]) });

/** Dev only: switches the simulated reader between ok and down. */
export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") return new Response(null, { status: 404 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_input" }, { status: 400 });
  setFakeAccessMode(parsed.data.mode);
  return Response.json({ mode: parsed.data.mode });
}
