import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/auth/guard";
import { listMemberships } from "@/auth/service";
import { getSessionUser } from "@/auth/sessions";

export default async function Home() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const user = token ? await getSessionUser(token) : null;
  if (!user) redirect("/login");
  const [first] = await listMemberships(user.userId);
  redirect(first ? `/o/${first.orgId}` : "/login");
}
