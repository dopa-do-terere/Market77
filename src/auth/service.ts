import { z } from "zod";
import { adminSql } from "@/db/client";
import { AppError, isUniqueViolation } from "@/lib/errors";
import { parse } from "@/lib/validate";
import { hashPassword, verifyPassword } from "./password";
import type { Role } from "./permissions";
import { createSession } from "./sessions";

const email = z.string().trim().toLowerCase().email();
const password = z.string().min(8).max(200);

const SignUp = z.object({ email, password, orgName: z.string().trim().min(2).max(100) });
const Login = z.object({ email, password: z.string().min(1) });
const AddMember = z.object({
  email,
  password: password.optional(),
  role: z.enum(["manager", "restocker"]),
});

export async function signUp(raw: unknown) {
  const input = parse(SignUp, raw);
  const passwordHash = await hashPassword(input.password);
  let ids: { userId: string; orgId: string };
  try {
    ids = await adminSql.begin(async (tx) => {
      const [u] = await tx`
        insert into users (email, password_hash) values (${input.email}, ${passwordHash}) returning id`;
      const [o] = await tx`insert into organizations (name) values (${input.orgName}) returning id`;
      await tx`insert into memberships (org_id, user_id, role) values (${o.id}, ${u.id}, 'owner')`;
      return { userId: u.id as string, orgId: o.id as string };
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new AppError("email_taken");
    throw e;
  }
  const { token, expiresAt } = await createSession(ids.userId);
  return { ...ids, token, expiresAt };
}

// ponytail: unknown email skips the scrypt cost, so timing can reveal which emails exist.
// Verify against a dummy hash if account enumeration becomes a concern.
export async function login(raw: unknown) {
  const input = parse(Login, raw);
  const [u] = await adminSql`select id, password_hash from users where email = ${input.email}`;
  const ok = u ? await verifyPassword(input.password, u.password_hash as string) : false;
  if (!u || !ok) throw new AppError("invalid_credentials");
  const { token, expiresAt } = await createSession(u.id as string);
  return { userId: u.id as string, token, expiresAt };
}

/** Existing users keep their own password; only brand new users get the one provided. */
export async function addMember(orgId: string, raw: unknown): Promise<void> {
  const input = parse(AddMember, raw);
  await adminSql.begin(async (tx) => {
    let [u] = await tx`select id from users where email = ${input.email}`;
    if (!u) {
      if (!input.password) throw new AppError("invalid_input", "password required for new user");
      const hash = await hashPassword(input.password);
      [u] = await tx`insert into users (email, password_hash) values (${input.email}, ${hash}) returning id`;
    }
    try {
      await tx`insert into memberships (org_id, user_id, role) values (${orgId}, ${u.id}, ${input.role})`;
    } catch (e) {
      if (isUniqueViolation(e)) throw new AppError("already_member");
      throw e;
    }
  });
}

export async function listMemberships(userId: string) {
  const rows = await adminSql`
    select m.org_id, m.role, o.name
    from memberships m join organizations o on o.id = m.org_id
    where m.user_id = ${userId} order by o.name`;
  return rows.map((r) => ({
    orgId: r.org_id as string,
    orgName: r.name as string,
    role: r.role as Role,
  }));
}

export async function getMembership(userId: string, orgId: string): Promise<Role | null> {
  if (!z.string().uuid().safeParse(orgId).success) return null;
  const [r] = await adminSql`
    select role from memberships where user_id = ${userId} and org_id = ${orgId}`;
  return r ? (r.role as Role) : null;
}
