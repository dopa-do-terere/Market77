import { cancelPaymentHandler } from "@/pdv/http";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return cancelPaymentHandler(req, (await params).id);
}
