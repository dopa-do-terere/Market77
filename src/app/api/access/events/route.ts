import { eventHandler } from "@/access/http";

export async function POST(req: Request) {
  return eventHandler(req);
}
