"use server";
import { redirect } from "next/navigation";
import { redirectOnAppError } from "@/app/action-utils";
import { requireOrg } from "@/auth/guard";
import { withOrg } from "@/db/tenant";
import { setMarketProduct } from "@/domain/market-products";
import { recordMovement } from "@/domain/stock";
import { AppError } from "@/lib/errors";
import { parseBRL } from "@/lib/money";
import { formToObject } from "@/lib/validate";

export async function setMarketProductAction(orgId: string, marketId: string, fd: FormData) {
  const path = `/o/${orgId}/markets/${marketId}`;
  try {
    await requireOrg(orgId, "price:write");
    const raw = formToObject(fd);
    const priceCents = parseBRL(raw.price ?? "");
    if (priceCents === null) throw new AppError("invalid_input", "invalid price");
    await withOrg(orgId, (tx) =>
      setMarketProduct(tx, orgId, {
        marketId,
        productId: raw.productId,
        priceCents,
        minStock: Number(raw.minStock ?? 0),
        active: raw.active === "on",
        tracksExpiry: raw.tracksExpiry === "on",
      }),
    );
  } catch (e) {
    redirectOnAppError(e, path);
  }
  redirect(path);
}

export async function moveStockAction(orgId: string, marketId: string, marketProductId: string, fd: FormData) {
  const path = `/o/${orgId}/markets/${marketId}`;
  try {
    const { userId } = await requireOrg(orgId, "stock:move");
    const raw = formToObject(fd);
    await withOrg(orgId, (tx) =>
      recordMovement(tx, orgId, userId, {
        marketProductId,
        type: raw.type,
        quantity: Number(raw.quantity),
        note: raw.note,
        expiresOn: raw.expiresOn,
        lotId: raw.lotId,
      }),
    );
  } catch (e) {
    redirectOnAppError(e, path);
  }
  redirect(path);
}
