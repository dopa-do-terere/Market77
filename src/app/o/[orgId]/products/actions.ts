"use server";
import { redirect } from "next/navigation";
import { redirectOnAppError } from "@/app/action-utils";
import { requireOrg } from "@/auth/guard";
import { withOrg } from "@/db/tenant";
import { createProduct, updateProductFiscal } from "@/domain/products";
import { formToObject } from "@/lib/validate";

export async function createProductAction(orgId: string, fd: FormData) {
  const path = `/o/${orgId}/products`;
  try {
    await requireOrg(orgId, "product:write");
    const raw = formToObject(fd);
    const barcodes = (raw.barcodes ?? "").split(/[\s,;]+/).filter(Boolean);
    await withOrg(orgId, (tx) => createProduct(tx, orgId, { ...raw, barcodes }));
  } catch (e) {
    redirectOnAppError(e, path);
  }
  redirect(path);
}

export async function updateProductFiscalAction(orgId: string, productId: string, fd: FormData) {
  const path = `/o/${orgId}/products`;
  try {
    await requireOrg(orgId, "product:write");
    const raw = formToObject(fd);
    await withOrg(orgId, (tx) =>
      updateProductFiscal(tx, productId, {
        ncm: raw.ncm,
        cest: raw.cest,
        cfop: raw.cfop,
        csosn: raw.csosn,
        unit: raw.unit,
        origin: raw.origin ? Number(raw.origin) : undefined,
      }),
    );
  } catch (e) {
    redirectOnAppError(e, path);
  }
  redirect(path);
}
