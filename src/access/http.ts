import { withOrg } from "@/db/tenant";
import { recordAccessEvent } from "@/domain/access";
import { AppError } from "@/lib/errors";
import { requireSource } from "./auth";

const STATUS: Record<string, number> = { invalid_input: 400, unauthorized: 401, source_revoked: 401 };
const MESSAGES: Record<string, string> = {
  invalid_input: "Dados inválidos.",
  unauthorized: "Leitor não autorizado.",
  source_revoked: "Leitor desativado.",
};

function errorResponse(e: unknown): Response {
  if (e instanceof AppError) {
    return Response.json(
      { error: e.code, message: MESSAGES[e.code] ?? "Erro inesperado." },
      { status: STATUS[e.code] ?? 400 },
    );
  }
  console.error(e);
  return Response.json({ error: "internal", message: "Erro inesperado." }, { status: 500 });
}

async function bodyOf(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new AppError("invalid_input");
  }
}

/** POST /api/access/events: 201 for a new entry, 200 { duplicate: true } for a repeated event id. */
export const eventHandler = async (req: Request, now: Date = new Date()): Promise<Response> => {
  try {
    const auth = await requireSource(req);
    const raw = await bodyOf(req);
    const r = await withOrg(auth.orgId, (tx) => recordAccessEvent(tx, auth, raw, now));
    return r.duplicate ? Response.json({ duplicate: true }) : Response.json({ id: r.id }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
};
