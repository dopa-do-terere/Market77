import { heartbeatHandler } from "@/agent/http";

export const POST = (req: Request) => heartbeatHandler(req);
