import { beforeEach, describe, expect, it } from "vitest";
import { adminSql } from "@/db/client";
import { addMember, getMembership, listMemberships, login, signUp } from "@/auth/service";
import { getSessionUser } from "@/auth/sessions";
import { AppError } from "@/lib/errors";
import { resetDb } from "../helpers";

beforeEach(resetDb);

const ana = { email: "ana@x.com", password: "senha-forte-1", orgName: "Mercados Ana" };

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (e) {
    return e instanceof AppError ? e.code : "not-app-error";
  }
}

describe("signUp", () => {
  it("creates user, organization, owner membership and a session", async () => {
    const r = await signUp(ana);
    expect(await getSessionUser(r.token)).toEqual({ userId: r.userId });
    expect(await getMembership(r.userId, r.orgId)).toBe("owner");
  });

  it("treats emails case- and whitespace-insensitively", async () => {
    await signUp(ana);
    expect(await codeOf(signUp({ ...ana, email: "  ANA@x.com " }))).toBe("email_taken");
    const [{ count }] = await adminSql`select count(*)::int as count from users`;
    expect(count).toBe(1);
  });

  it("rejects short passwords and bad emails", async () => {
    expect(await codeOf(signUp({ ...ana, password: "1234567" }))).toBe("invalid_input");
    expect(await codeOf(signUp({ ...ana, email: "nope" }))).toBe("invalid_input");
  });
});

describe("login", () => {
  it("logs in with the right password", async () => {
    const s = await signUp(ana);
    const r = await login({ email: "ANA@x.com", password: ana.password });
    expect(r.userId).toBe(s.userId);
  });

  it("gives the same error for wrong password and unknown email", async () => {
    await signUp(ana);
    expect(await codeOf(login({ email: ana.email, password: "errada-123" }))).toBe("invalid_credentials");
    expect(await codeOf(login({ email: "x@x.com", password: "qualquer-123" }))).toBe("invalid_credentials");
  });
});

describe("memberships", () => {
  it("adds a new user as manager with required password", async () => {
    const a = await signUp(ana);
    await addMember(a.orgId, { email: "gil@x.com", password: "senha-gil-123", role: "manager" });
    const gil = await login({ email: "gil@x.com", password: "senha-gil-123" });
    expect(await getMembership(gil.userId, a.orgId)).toBe("manager");
  });

  it("rejects existing email with email_taken", async () => {
    const a = await signUp(ana);
    await addMember(a.orgId, { email: "gil@x.com", password: "senha-gil-123", role: "manager" });
    // Existing user cannot join another org without invitation flow
    expect(await codeOf(addMember(a.orgId, { email: "GIL@x.com", password: "outra-senha-123", role: "restocker" }))).toBe("email_taken");
    // Verify no membership was created
    const gil = await login({ email: "gil@x.com", password: "senha-gil-123" });
    const orgs = await listMemberships(gil.userId);
    expect(orgs.length).toBe(1);
    expect(orgs[0].role).toBe("manager");
  });

  it("requires a password and rejects duplicate in same org", async () => {
    const a = await signUp(ana);
    expect(await codeOf(addMember(a.orgId, { email: "novo@x.com", password: "", role: "manager" }))).toBe("invalid_input");
    await addMember(a.orgId, { email: "gil@x.com", password: "senha-gil-123", role: "manager" });
    expect(await codeOf(addMember(a.orgId, { email: "gil@x.com", password: "outra-senha-123", role: "manager" }))).toBe("email_taken");
  });

  it("returns null for a non-uuid org id instead of throwing", async () => {
    const a = await signUp(ana);
    expect(await getMembership(a.userId, "not-a-uuid")).toBeNull();
  });
});
