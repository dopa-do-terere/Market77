import { buildFakeWebhook } from "@/payments/fake";
import { handleProviderWebhook } from "@/payments/webhook";

/** Dev only: makes the simulated provider pay a charge, through the real webhook path. */
export async function POST(_req: Request, { params }: { params: Promise<{ externalId: string }> }) {
  if (process.env.NODE_ENV === "production") return new Response(null, { status: 404 });
  const { externalId } = await params;
  const { headers, rawBody } = buildFakeWebhook(externalId);
  const r = await handleProviderWebhook("fake", headers, rawBody);
  return Response.json(r.body, { status: r.status });
}
