import { releaseHandler } from "@/agent/http";

export async function GET(req: Request, { params }: { params: Promise<{ version: string }> }) {
  return releaseHandler(req, (await params).version);
}
