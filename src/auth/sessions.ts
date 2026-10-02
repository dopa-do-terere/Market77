import { createHash, randomBytes } from "node:crypto";
import { adminSql } from "@/db/client";

const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

// ponytail: expired rows are never purged, add a cleanup job if the table grows.
export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const [row] = await adminSql`
    insert into sessions (token_hash, user_id, expires_at)
    values (${hashToken(token)}, ${userId}, now() + interval '30 days')
    returning expires_at`;
  return { token, expiresAt: row.expires_at as Date };
}

export async function getSessionUser(token: string): Promise<{ userId: string } | null> {
  const [row] = await adminSql`
    select user_id from sessions where token_hash = ${hashToken(token)} and expires_at > now()`;
  return row ? { userId: row.user_id as string } : null;
}

export async function deleteSession(token: string): Promise<void> {
  await adminSql`delete from sessions where token_hash = ${hashToken(token)}`;
}
