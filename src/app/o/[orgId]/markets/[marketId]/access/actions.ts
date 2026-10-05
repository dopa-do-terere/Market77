"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { redirectOnAppError } from "@/app/action-utils";
import { requireOrg } from "@/auth/guard";
import { withOrg } from "@/db/tenant";
import { createAccessSource, forgetAccessPerson, revokeAccessSource } from "@/domain/access";
import { AppError } from "@/lib/errors";
import { message } from "@/lib/messages";
import { formToObject } from "@/lib/validate";

export type CreateSourceState = { token?: string; name?: string; error?: string };

/** Returns the plain token in the response: it is shown once and never stored or put in a URL. */
export async function createAccessSourceAction(
  orgId: string,
  marketId: string,
  _prev: CreateSourceState,
  fd: FormData,
): Promise<CreateSourceState> {
  try {
    await requireOrg(orgId, "access:write");
    const raw = formToObject(fd);
    const { token } = await withOrg(orgId, (tx) => createAccessSource(tx, orgId, { marketId, name: raw.name }));
    revalidatePath(`/o/${orgId}/markets/${marketId}/access`);
    return { token, name: raw.name };
  } catch (e) {
    if (e instanceof AppError) return { error: message(e.code) };
    throw e;
  }
}

export async function revokeAccessSourceAction(orgId: string, marketId: string, sourceId: string) {
  const path = `/o/${orgId}/markets/${marketId}/access`;
  try {
    await requireOrg(orgId, "access:write");
    await withOrg(orgId, (tx) => revokeAccessSource(tx, sourceId));
  } catch (e) {
    redirectOnAppError(e, path);
  }
  redirect(path);
}

export async function forgetAccessPersonAction(orgId: string, marketId: string, personId: string) {
  const path = `/o/${orgId}/markets/${marketId}/access`;
  try {
    await requireOrg(orgId, "access:write");
    await withOrg(orgId, (tx) => forgetAccessPerson(tx, personId, new Date()));
  } catch (e) {
    redirectOnAppError(e, path);
  }
  redirect(path);
}
