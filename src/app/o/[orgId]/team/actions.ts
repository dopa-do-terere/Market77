"use server";
import { redirect } from "next/navigation";
import { redirectOnAppError } from "@/app/action-utils";
import { requireOrg } from "@/auth/guard";
import { addMember } from "@/auth/service";
import { formToObject } from "@/lib/validate";

export async function addMemberAction(orgId: string, fd: FormData) {
  const path = `/o/${orgId}/team`;
  try {
    await requireOrg(orgId, "member:write");
    await addMember(orgId, formToObject(fd));
  } catch (e) {
    redirectOnAppError(e, path);
  }
  redirect(`${path}?ok=1`);
}
