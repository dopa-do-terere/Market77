"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { redirectOnAppError } from "@/app/action-utils";
import { releaseStore } from "@/agent/releases";
import { requireOrg } from "@/auth/guard";
import { withOrg } from "@/db/tenant";
import { createCommand } from "@/domain/agent";
import { createTerminal, revokeTerminal, setTerminalDevice } from "@/domain/terminals";
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

/** `update` always targets the most recently published package; the others carry no data. */
export async function sendCommandAction(orgId: string, terminalId: string, type: string) {
  const path = `/o/${orgId}/terminals`;
  try {
    const { userId } = await requireOrg(orgId, "terminal:write");
    let version: string | undefined;
    if (type === "update") {
      const latest = await releaseStore.latest();
      if (!latest) throw new AppError("release_not_found");
      version = latest.version;
    }
    await withOrg(orgId, (tx) => createCommand(tx, orgId, userId, { terminalId, type, version }, new Date()));
  } catch (e) {
    redirectOnAppError(e, path);
  }
  redirect(path);
}

export async function setTerminalDeviceAction(orgId: string, terminalId: string, fd: FormData) {
  const path = `/o/${orgId}/terminals`;
  try {
    await requireOrg(orgId, "terminal:write");
    const raw = formToObject(fd);
    await withOrg(orgId, (tx) => setTerminalDevice(tx, terminalId, raw));
  } catch (e) {
    redirectOnAppError(e, path);
  }
  redirect(path);
}
