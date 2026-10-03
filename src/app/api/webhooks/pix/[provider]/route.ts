import { handleProviderWebhook } from "@/payments/webhook";

export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const r = await handleProviderWebhook(provider, req.headers, await req.text());
  return Response.json(r.body, { status: r.status });
}
