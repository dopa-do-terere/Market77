import { buildFakeCardWebhook } from "@/payments/fake-card";
import { handleCardWebhook } from "@/payments/webhook";

/** Dev only: the machine approves a charge, through the real webhook path. */
export async function POST(_req: Request, { params }: { params: Promise<{ externalId: string }> }) {
  if (process.env.NODE_ENV === "production") return new Response(null, { status: 404 });
  const { externalId } = await params;
  const { headers, rawBody } = buildFakeCardWebhook(externalId, { status: "confirmed" });
  const r = await handleCardWebhook("fake", headers, rawBody);
  return Response.json(r.body, { status: r.status });
}
