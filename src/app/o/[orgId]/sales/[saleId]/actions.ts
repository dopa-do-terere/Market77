"use server";
import { redirect } from "next/navigation";
import { redirectOnAppError } from "@/app/action-utils";
import { requireOrg } from "@/auth/guard";
import { withOrg } from "@/db/tenant";
import { reissueFiscalDocument } from "@/domain/fiscal";

export async function reissueFiscalAction(orgId: string, saleId: string) {
  const path = `/o/${orgId}/sales/${saleId}`;
  try {
    await requireOrg(orgId, "market:write");
    await withOrg(orgId, (tx) => reissueFiscalDocument(tx, saleId, new Date()));
  } catch (e) {
    redirectOnAppError(e, path);
  }
  redirect(path);
}
