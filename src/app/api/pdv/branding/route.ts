import { handle } from "@/pdv/http";
import { withOrg } from "@/db/tenant";
import { getBranding } from "@/domain/branding";

export const GET = (req: Request) => handle(req, (t) => withOrg(t.orgId, async (tx) => ({ branding: await getBranding(tx) })));
