import { cancelHandler } from "@/pdv/http";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return cancelHandler(req, (await params).id);
}
