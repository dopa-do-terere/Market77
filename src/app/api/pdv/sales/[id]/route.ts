import { getSaleHandler } from "@/pdv/http";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return getSaleHandler(req, (await params).id);
}
