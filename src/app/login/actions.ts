"use server";
import { redirect } from "next/navigation";
import { redirectOnAppError, setSessionCookie } from "@/app/action-utils";
import { listMemberships, login } from "@/auth/service";
import { formToObject } from "@/lib/validate";

export async function loginAction(fd: FormData) {
  let target: string;
  try {
    const r = await login(formToObject(fd));
    await setSessionCookie(r.token, r.expiresAt);
    const [first] = await listMemberships(r.userId);
    target = first ? `/o/${first.orgId}` : "/login?error=forbidden";
  } catch (e) {
    redirectOnAppError(e, "/login");
  }
  redirect(target);
}
