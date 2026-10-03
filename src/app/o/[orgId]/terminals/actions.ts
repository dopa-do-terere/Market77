"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { redirectOnAppError } from "@/app/action-utils";
import { requireOrg } from "@/auth/guard";
import { withOrg } from "@/db/tenant";
import { createTerminal, revokeTerminal } from "@/domain/terminals";
import { AppError } from "@/lib/errors";
import { message } from "@/lib/messages";
import { formToObject } from "@/lib/validate";

export type CreateTerminalState = { token?: string; name?: string; error?: string };

/** Returns the plain token in the response: it is shown once and never stored or put in a URL. */
export async function createTerminalAction(
  orgId: string,
  _prev: CreateTerminalState,
  fd: FormData,
): Promise<CreateTerminalState> {
  try {
    await requireOrg(orgId, "terminal:write");
    const raw = formToObject(fd);
    const { token } = await withOrg(orgId, (tx) => createTerminal(tx, orgId, raw));
    revalidatePath(`/o/${orgId}/terminals`);
    return { token, name: raw.name };
  } catch (e) {
    if (e instanceof AppError) return { error: message(e.code) };
    throw e;
  }
}

export async function revokeTerminalAction(orgId: string, terminalId: string) {
  const path = `/o/${orgId}/terminals`;
  try {
    await requireOrg(orgId, "terminal:write");
    await withOrg(orgId, (tx) => revokeTerminal(tx, terminalId));
  } catch (e) {
    redirectOnAppError(e, path);
  }
  redirect(path);
}
