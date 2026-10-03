import { payHandler } from "@/pdv/http";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return payHandler(req, (await params).id);
}
