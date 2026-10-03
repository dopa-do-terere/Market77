import { pingHandler } from "@/pdv/http";

export const GET = (req: Request) => pingHandler(req);
