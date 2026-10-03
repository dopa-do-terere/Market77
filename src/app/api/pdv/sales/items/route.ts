import { scanHandler } from "@/pdv/http";

export const POST = (req: Request) => scanHandler(req);
