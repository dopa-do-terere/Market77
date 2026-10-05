import { handleMercadoPagoWebhook } from "@/payments/webhook";

export async function POST(req: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const r = await handleMercadoPagoWebhook(orgId, new URL(req.url), req.headers, await req.text());
  return Response.json(r.body, { status: r.status });
}
