import { publishReleaseHandler } from "@/agent/http";

export const POST = (req: Request) => publishReleaseHandler(req);
