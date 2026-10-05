import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { AppError } from "./errors";

function key(): Buffer {
  const k = Buffer.from(process.env.CREDENTIALS_KEY ?? "", "base64");
  if (k.length !== 32) throw new AppError("credentials_key_missing");
  return k;
}

/** AES-256-GCM. Format v1:<iv>:<tag>:<data>, each part in base64 (which never contains a colon). */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), data.toString("base64")].join(":");
}

/** Throws on a malformed or tampered blob. */
export function decryptSecret(blob: string): string {
  const parts = blob.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") throw new Error("malformed secret");
  const iv = Buffer.from(parts[1], "base64");
  const tag = Buffer.from(parts[2], "base64");
  if (iv.length !== 12 || tag.length !== 16) throw new Error("malformed secret");
  const d = createDecipheriv("aes-256-gcm", key(), iv, { authTagLength: 16 });
  d.setAuthTag(tag);
  return Buffer.concat([d.update(Buffer.from(parts[3], "base64")), d.final()]).toString("utf8");
}
