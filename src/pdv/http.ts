import { withOrg } from "@/db/tenant";
import { startPayment } from "@/domain/payments";
import { refreshSale } from "@/domain/refresh";
import { addItemByBarcode, cancelSale, setItemQuantity } from "@/domain/sales";
import { AppError } from "@/lib/errors";
import { message } from "@/lib/messages";
import { getProvider } from "@/payments/registry";
import { type TerminalAuth, requireTerminal } from "./auth";

const STATUS: Record<string, number> = {
  invalid_input: 400,
  unauthorized: 401,
  terminal_revoked: 401,
  forbidden: 403,
  not_found: 404,
  sale_not_found: 404,
  product_not_found: 404,
  product_inactive: 404,
  sale_not_editable: 409,
  sale_empty: 422,
  sale_too_large: 422,
  quantity_limit: 422,
  provider_unavailable: 503,
};

export function errorResponse(e: unknown): Response {
  if (e instanceof AppError) {
    return Response.json({ error: e.code, message: message(e.code) }, { status: STATUS[e.code] ?? 400 });
  }
  console.error(e);
  return Response.json({ error: "internal", message: message("internal") }, { status: 500 });
}

async function handle(req: Request, fn: (t: TerminalAuth) => Promise<unknown>): Promise<Response> {
  try {
    return Response.json(await fn(await requireTerminal(req)));
  } catch (e) {
    return errorResponse(e);
  }
}

async function bodyOf(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new AppError("invalid_input");
  }
}

const ctx = (t: TerminalAuth) => ({ terminalId: t.terminalId, marketId: t.marketId });

export const pingHandler = (req: Request) => handle(req, async () => ({ ok: true }));

export const scanHandler = (req: Request, now: Date = new Date()) =>
  handle(req, async (t) => {
    const raw = await bodyOf(req);
    return withOrg(t.orgId, (tx) => addItemByBarcode(tx, t.orgId, ctx(t), raw, now));
  });

export const setQuantityHandler = (req: Request, saleId: string, itemId: string, now: Date = new Date()) =>
  handle(req, async (t) => {
    const body = (await bodyOf(req)) as { quantity?: unknown } | null;
    return withOrg(t.orgId, (tx) =>
      setItemQuantity(tx, ctx(t), saleId, { itemId, quantity: body?.quantity }, now),
    );
  });

export const payHandler = (req: Request, saleId: string, now: Date = new Date()) =>
  handle(req, (t) =>
    withOrg(t.orgId, (tx) => startPayment(tx, t.orgId, ctx(t), saleId, getProvider(), now)),
  );

export const getSaleHandler = (req: Request, saleId: string, now: Date = new Date()) =>
  handle(req, (t) => withOrg(t.orgId, (tx) => refreshSale(tx, ctx(t), saleId, getProvider(), now)));

export const cancelHandler = (req: Request, saleId: string, now: Date = new Date()) =>
  handle(req, (t) => withOrg(t.orgId, (tx) => cancelSale(tx, ctx(t), saleId, now)));
