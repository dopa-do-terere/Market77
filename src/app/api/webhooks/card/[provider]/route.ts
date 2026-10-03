import { handleCardWebhook } from "@/payments/webhook";

export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const r = await handleCardWebhook(provider, req.headers, await req.text());
  return Response.json(r.body, { status: r.status });
}
