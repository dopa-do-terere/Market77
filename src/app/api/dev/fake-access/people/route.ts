import { z } from "zod";
import { setFakePeople } from "@/access/fake-access";

const Body = z.object({
  sourceId: z.string().min(1),
  people: z
    .array(z.object({ externalId: z.string().min(1).max(64), name: z.string().min(1).max(120) }))
    .max(5000),
});

/** Dev only: sets the people a simulated reader reports. */
export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") return new Response(null, { status: 404 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_input" }, { status: 400 });
  setFakePeople(parsed.data.sourceId, parsed.data.people);
  return Response.json({ count: parsed.data.people.length });
}
