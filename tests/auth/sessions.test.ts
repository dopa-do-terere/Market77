import { beforeEach, describe, expect, it } from "vitest";
import { adminSql } from "@/db/client";
import { createSession, deleteSession, getSessionUser } from "@/auth/sessions";
import { makeUser, resetDb } from "../helpers";

beforeEach(resetDb);

describe("sessions", () => {
  it("resolves a valid token to its user", async () => {
    const userId = await makeUser("a@x.com");
    const { token } = await createSession(userId);
    expect(await getSessionUser(token)).toEqual({ userId });
  });

  it("stores only a hash of the token", async () => {
    const userId = await makeUser("a@x.com");
    const { token } = await createSession(userId);
    const rows = await adminSql`select token_hash from sessions`;
    expect(rows[0].token_hash).not.toBe(token);
  });

  it("rejects expired, deleted and unknown tokens", async () => {
    const userId = await makeUser("a@x.com");
    const { token } = await createSession(userId);
    await adminSql`update sessions set expires_at = now() - interval '1 minute'`;
    expect(await getSessionUser(token)).toBeNull();

    const second = await createSession(userId);
    await deleteSession(second.token);
    expect(await getSessionUser(second.token)).toBeNull();
    expect(await getSessionUser("nao-existe")).toBeNull();
  });
});
