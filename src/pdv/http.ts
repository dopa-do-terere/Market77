import { z } from "zod";
import { withOrg } from "@/db/tenant";
import { cancelPayment, startPayment } from "@/domain/payments";
import { refreshSale } from "@/domain/refresh";
import { addItemByBarcode, cancelSale, setCustomerCpf, setItemQuantity } from "@/domain/sales";
import { AppError } from "@/lib/errors";
import { parse } from "@/lib/validate";
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
  product_expired: 404,
  sale_not_editable: 409,
  sale_empty: 422,
  sale_too_large: 422,
  quantity_limit: 422,
  invalid_cpf: 400,
  provider_unavailable: 503,
  command_in_progress: 409,
  release_not_found: 404,
  release_exists: 409,
  release_too_large: 413,
};

export function errorResponse(e: unknown): Response {
  if (e instanceof AppError) {
    return Response.json({ error: e.code, message: message(e.code) }, { status: STATUS[e.code] ?? 400 });
  }
  console.error(e);
  return Response.json({ error: "internal", message: message("internal") }, { status: 500 });
}

export async function handle(req: Request, fn: (t: TerminalAuth) => Promise<unknown>): Promise<Response> {
  try {
    return Response.json(await fn(await requireTerminal(req)));
  } catch (e) {
    return errorResponse(e);
  }
}

export async function bodyOf(req: Request): Promise<unknown> {
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

export const customerHandler = (req: Request, saleId: string, now: Date = new Date()) =>
  handle(req, async (t) => {
    const raw = await bodyOf(req);
    return withOrg(t.orgId, (tx) => setCustomerCpf(tx, ctx(t), saleId, raw, now));
  });

const PayInput = z.object({ method: z.enum(["pix", "card"]).optional() });

/** An optional JSON body: empty means {}; broken JSON is invalid_input. */
async function optionalBody(req: Request): Promise<unknown> {
  const text = await req.text();
  if (text.trim() === "") return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError("invalid_input");
  }
}

export const payHandler = (req: Request, saleId: string, now: Date = new Date()) =>
  handle(req, async (t) => {
    const { method } = parse(PayInput, await optionalBody(req));
    return withOrg(t.orgId, (tx) => startPayment(tx, t.orgId, ctx(t), saleId, getProvider(), now, { method }));
  });

export const cancelPaymentHandler = (req: Request, saleId: string, now: Date = new Date()) =>
  handle(req, (t) => withOrg(t.orgId, (tx) => cancelPayment(tx, ctx(t), saleId, now)));

export const getSaleHandler = (req: Request, saleId: string, now: Date = new Date()) =>
  handle(req, (t) => withOrg(t.orgId, (tx) => refreshSale(tx, ctx(t), saleId, getProvider(), now)));

export const cancelHandler = (req: Request, saleId: string, now: Date = new Date()) =>
  handle(req, (t) => withOrg(t.orgId, (tx) => cancelSale(tx, ctx(t), saleId, now)));
