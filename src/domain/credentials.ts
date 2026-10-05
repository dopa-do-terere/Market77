import { z } from "zod";
import { adminSql } from "@/db/client";
import type { Tx } from "@/db/tenant";
import { decryptSecret, encryptSecret } from "@/lib/secrets";
import { parse } from "@/lib/validate";

export type MercadoPagoCredentials = { accessToken: string; webhookSecret: string };
export type CredentialsStatus = { configured: boolean; last4: string | null; updatedAt: Date | null };

// Printable ASCII without spaces: tokens and secrets are copied from the Mercado Pago panel.
const Input = z.object({
  accessToken: z.string().trim().min(10).max(300).regex(/^[\x21-\x7e]+$/),
  webhookSecret: z.string().trim().min(8).max(200).regex(/^[\x21-\x7e]+$/),
});

export async function saveMercadoPagoCredentials(tx: Tx, orgId: string, raw: unknown): Promise<void> {
  const i = parse(Input, raw);
  await tx`
    insert into provider_credentials (org_id, provider, access_token_enc, webhook_secret_enc, token_last4)
    values (${orgId}, 'mercadopago', ${encryptSecret(i.accessToken)}, ${encryptSecret(i.webhookSecret)}, ${i.accessToken.slice(-4)})
    on conflict (org_id, provider) do update set
      access_token_enc = excluded.access_token_enc,
      webhook_secret_enc = excluded.webhook_secret_enc,
      token_last4 = excluded.token_last4,
      updated_at = now()`;
}

/** Only the state: the secrets never leave the server. */
export async function mercadoPagoStatus(tx: Tx): Promise<CredentialsStatus> {
  const [r] = await tx`select token_last4, updated_at from provider_credentials where provider = 'mercadopago'`;
  return r
    ? { configured: true, last4: r.token_last4 as string, updatedAt: r.updated_at as Date }
    : { configured: false, last4: null, updatedAt: null };
}

export async function removeMercadoPagoCredentials(tx: Tx): Promise<void> {
  await tx`delete from provider_credentials where provider = 'mercadopago'`;
}

type Row = Record<string, unknown>;
const open = (r: Row): MercadoPagoCredentials => ({
  accessToken: decryptSecret(r.access_token_enc as string),
  webhookSecret: decryptSecret(r.webhook_secret_enc as string),
});

/** The organization of the transaction (RLS). Throws when the stored blob cannot be decrypted. */
export async function readOwnMercadoPagoCredentials(tx: Tx): Promise<MercadoPagoCredentials | null> {
  const [r] = await tx`
    select access_token_enc, webhook_secret_enc from provider_credentials where provider = 'mercadopago'`;
  return r ? open(r) : null;
}

/** Without a session (webhook): admin role, always filtered by the organization of the URL. */
export async function readMercadoPagoCredentials(orgId: string): Promise<MercadoPagoCredentials | null> {
  const [r] = await adminSql`
    select access_token_enc, webhook_secret_enc from provider_credentials
    where org_id = ${orgId} and provider = 'mercadopago'`;
  return r ? open(r) : null;
}
