"use server";
import { redirect } from "next/navigation";
import { redirectOnAppError } from "@/app/action-utils";
import { requireOrg } from "@/auth/guard";
import { withOrg } from "@/db/tenant";
import { createMarket } from "@/domain/markets";
import { formToObject } from "@/lib/validate";

export async function createMarketAction(orgId: string, fd: FormData) {
  const path = `/o/${orgId}/markets`;
  try {
    await requireOrg(orgId, "market:write");
    await withOrg(orgId, (tx) => createMarket(tx, orgId, formToObject(fd)));
  } catch (e) {
    redirectOnAppError(e, path);
  }
  redirect(path);
}
