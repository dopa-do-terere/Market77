"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { redirectOnAppError } from "@/app/action-utils";
import { requireOrg } from "@/auth/guard";
import { withOrg } from "@/db/tenant";
import {
  readOwnMercadoPagoCredentials,
  removeMercadoPagoCredentials,
  saveMercadoPagoCredentials,
} from "@/domain/credentials";
import { AppError } from "@/lib/errors";
import { formToObject } from "@/lib/validate";
import { mpCall } from "@/payments/mercadopago-http";
import { withTimeout } from "@/payments/provider";

const pathOf = (orgId: string) => `/o/${orgId}/settings/payments`;

export async function saveCredentialsAction(orgId: string, fd: FormData) {
  try {
    await requireOrg(orgId, "payment:write");
    const raw = formToObject(fd);
    await withOrg(orgId, (tx) => saveMercadoPagoCredentials(tx, orgId, raw));
  } catch (e) {
    redirectOnAppError(e, pathOf(orgId));
  }
  revalidatePath(pathOf(orgId));
  redirect(`${pathOf(orgId)}?ok=saved`);
}

export async function removeCredentialsAction(orgId: string) {
  try {
    await requireOrg(orgId, "payment:write");
    await withOrg(orgId, (tx) => removeMercadoPagoCredentials(tx));
  } catch (e) {
    redirectOnAppError(e, pathOf(orgId));
  }
  revalidatePath(pathOf(orgId));
  redirect(`${pathOf(orgId)}?ok=removed`);
}

/** Asks Mercado Pago who the token belongs to. Nothing of the answer is shown or kept. */
export async function testCredentialsAction(orgId: string) {
  try {
    await requireOrg(orgId, "payment:write");
    const creds = await withOrg(orgId, (tx) => readOwnMercadoPagoCredentials(tx));
    if (!creds) throw new AppError("not_found");
    try {
      await withTimeout(mpCall(creds, fetch, "GET", "/users/me"));
    } catch {
      throw new AppError("credentials_test_failed");
    }
  } catch (e) {
    redirectOnAppError(e, pathOf(orgId));
  }
  redirect(`${pathOf(orgId)}?ok=tested`);
}
