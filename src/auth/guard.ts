import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AppError } from "@/lib/errors";
import { type Action, type Role, can } from "./permissions";
import { getMembership } from "./service";
import { getSessionUser } from "./sessions";

export const SESSION_COOKIE = "m77_session";

export async function requireUser(): Promise<{ userId: string }> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const user = token ? await getSessionUser(token) : null;
  if (!user) redirect("/login");
  return user;
}

/** Every page and action must call this: layouts do not re-run on client navigation. */
export async function requireOrg(
  orgId: string,
  action?: Action,
): Promise<{ userId: string; role: Role }> {
  const { userId } = await requireUser();
  const role = await getMembership(userId, orgId);
  if (!role || (action && !can(role, action))) throw new AppError("forbidden");
  return { userId, role };
}
