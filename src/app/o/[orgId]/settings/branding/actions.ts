"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireOrg } from "@/auth/guard";
import { withOrg } from "@/db/tenant";
import { logoDataUrl, MAX_LOGO_BYTES, saveBranding } from "@/domain/branding";
import { AppError } from "@/lib/errors";
import { redirectOnAppError } from "@/app/action-utils";

export async function saveBrandingAction(orgId: string, fd: FormData) {
  const path = `/o/${orgId}/settings/branding`;
  try {
    await requireOrg(orgId, "branding:write");
    const file = fd.get("logo");
    let logo: string | null | undefined;
    if (fd.get("removeLogo") === "on") logo = null;
    else if (file instanceof File && file.size > 0) {
      if (file.size > MAX_LOGO_BYTES) throw new AppError("logo_size");
      logo = logoDataUrl(new Uint8Array(await file.arrayBuffer()), file.type);
    }
    await withOrg(orgId, (tx) => saveBranding(tx, orgId, fd.get("name"), logo));
  } catch (e) { redirectOnAppError(e, path); }
  revalidatePath(`/o/${orgId}`, "layout");
  redirect(`${path}?saved=1`);
}
