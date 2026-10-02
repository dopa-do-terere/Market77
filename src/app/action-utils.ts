import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/auth/guard";
import { AppError } from "@/lib/errors";

/** Turns a domain AppError into a redirect with ?error=code; rethrows everything else
 *  (including Next's own redirect signals). */
export function redirectOnAppError(e: unknown, path: string): never {
  if (e instanceof AppError) redirect(`${path}?error=${e.code}`);
  throw e;
}

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires: expiresAt,
    path: "/",
  });
}
