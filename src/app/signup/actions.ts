"use server";
import { redirect } from "next/navigation";
import { redirectOnAppError, setSessionCookie } from "@/app/action-utils";
import { signUp } from "@/auth/service";
import { formToObject } from "@/lib/validate";

export async function signUpAction(fd: FormData) {
  let orgId: string;
  try {
    const r = await signUp(formToObject(fd));
    await setSessionCookie(r.token, r.expiresAt);
    orgId = r.orgId;
  } catch (e) {
    redirectOnAppError(e, "/signup");
  }
  redirect(`/o/${orgId}`);
}
