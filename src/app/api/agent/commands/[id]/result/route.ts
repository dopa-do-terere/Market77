import { resultHandler } from "@/agent/http";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return resultHandler(req, (await params).id);
}
