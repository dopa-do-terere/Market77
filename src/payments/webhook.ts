import { z } from "zod";
import { adminSql } from "@/db/client";
import { withOrg } from "@/db/tenant";
import { readMercadoPagoCredentials } from "@/domain/credentials";
import { confirmPayment, failPayment } from "@/domain/payments";
import type { CardProvider } from "./card";
import { mercadoPagoPoint } from "./mercadopago-card";
import { type Fetch, verifyNotification } from "./mercadopago-http";
import { mercadoPagoPix } from "./mercadopago-pix";
import { type PaymentProvider, withTimeout } from "./provider";
import { getCardProvider, getProvider } from "./registry";

type Outcome = { status: number; body: { result: string } };

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

/**
 * Provider callback. No session and no organization yet: verify the signature, find the payment
 * with adminSql (only to learn the organization), then confirm inside withOrg. Idempotent.
 */
export async function handleProviderWebhook(
  providerName: string,
  headers: Headers,
  rawBody: string,
  now: Date = new Date(),
): Promise<Outcome> {
  let provider: PaymentProvider;
  try {
    provider = getProvider(providerName);
  } catch {
    return { status: 404, body: { result: "unknown_provider" } };
  }
  let event: ReturnType<PaymentProvider["parseWebhook"]>;
  try {
    event = provider.parseWebhook(headers, rawBody);
  } catch {
    return { status: 401, body: { result: "invalid_webhook" } };
  }
  // ponytail: expired and failed events are ignored; refreshSale reads the same state from the provider.
  if (!event || event.status !== "confirmed") return { status: 200, body: { result: "ignored" } };

  const [p] = await adminSql`
    select id, org_id from payments
    where provider = ${provider.name} and external_id = ${event.externalId} and method = 'pix'`;
  if (!p) return { status: 200, body: { result: "unknown_payment" } };
  const result = await withOrg(p.org_id as string, (tx) =>
    confirmPayment(tx, p.id as string, event.amountCents, safeJson(rawBody), now),
  );
  return { status: 200, body: { result } };
}

/**
 * Card provider callback. Like the Pix one (no session, signature first, adminSql only to learn the
 * organization), but a decline, cancellation or expiry also acts: the sale goes back to the cart at
 * once instead of waiting for the next reconciliation. Idempotent; a confirmed payment never changes.
 */
export async function handleCardWebhook(
  providerName: string,
  headers: Headers,
  rawBody: string,
  now: Date = new Date(),
): Promise<Outcome> {
  let provider: CardProvider;
  try {
    provider = getCardProvider(providerName);
  } catch {
    return { status: 404, body: { result: "unknown_provider" } };
  }
  let event: ReturnType<CardProvider["parseWebhook"]>;
  try {
    event = provider.parseWebhook(headers, rawBody);
  } catch {
    return { status: 401, body: { result: "invalid_webhook" } };
  }
  if (!event) return { status: 200, body: { result: "ignored" } };

  const [p] = await adminSql`
    select id, org_id from payments
    where provider = ${provider.name} and external_id = ${event.externalId} and method = 'card'`;
  if (!p) return { status: 200, body: { result: "unknown_payment" } };
  const orgId = p.org_id as string;
  if (event.status === "confirmed") {
    const result = await withOrg(orgId, (tx) =>
      confirmPayment(tx, p.id as string, event.amountCents, safeJson(rawBody), now),
    );
    return { status: 200, body: { result } };
  }
  const reason = event.status === "expired" ? "expired" : (event.failureReason ?? "declined");
  const changed = await withOrg(orgId, (tx) => failPayment(tx, p.id as string, reason, now));
  return { status: 200, body: { result: changed ? "failed" : "ignored" } };
}

/**
 * Mercado Pago callback, one URL per organization because the signing secret is per organization.
 * The notification only says that an id changed: after the signature is verified, state and amount come
 * from the API, never from the body. The kind of the verified notification (payment or order) picks the method
 * and the adapter, not the URL: Mercado Pago lets one notification URL receive every topic. 503 makes Mercado Pago retry when the API cannot be asked.
 */
export async function handleMercadoPagoWebhook(
  orgId: string,
  url: URL,
  headers: Headers,
  rawBody: string,
  now: Date = new Date(),
  f: Fetch = fetch,
): Promise<Outcome> {
  if (!z.string().uuid().safeParse(orgId).success) return { status: 404, body: { result: "unknown_provider" } };
  let creds: Awaited<ReturnType<typeof readMercadoPagoCredentials>>;
  try {
    creds = await readMercadoPagoCredentials(orgId);
  } catch {
    creds = null; // cannot be decrypted: same as not connected
  }
  if (!creds) return { status: 404, body: { result: "unknown_provider" } };

  let n: ReturnType<typeof verifyNotification>;
  try {
    n = verifyNotification(creds.webhookSecret, headers, rawBody, url, now);
  } catch {
    return { status: 401, body: { result: "invalid_webhook" } };
  }
  if (!n) return { status: 200, body: { result: "ignored" } };
  const method = n.kind === "payment" ? "pix" : "card";

  const [p] = await adminSql`
    select id from payments
    where org_id = ${orgId} and provider = 'mercadopago' and external_id = ${n.id} and method = ${method}`;
  if (!p) return { status: 200, body: { result: "unknown_payment" } };

  let charge: Awaited<ReturnType<PaymentProvider["getCharge"]>> & { failureReason?: "declined" | "cancelled" };
  try {
    charge =
      method === "pix"
        ? await withTimeout(mercadoPagoPix(creds, f).getCharge(n.id))
        : await withTimeout(mercadoPagoPoint(creds, async () => null, f).getCharge(n.id));
  } catch {
    return { status: 503, body: { result: "provider_unavailable" } };
  }

  if (charge.status === "confirmed") {
    const result = await withOrg(orgId, (tx) =>
      confirmPayment(tx, p.id as string, charge.amountCents, safeJson(rawBody), now),
    );
    return { status: 200, body: { result } };
  }
  // A Pix that failed or expired is read again by the reconciliation; a card outcome acts at once.
  if (method === "pix" || charge.status === "pending") return { status: 200, body: { result: "ignored" } };
  const reason = charge.status === "expired" ? "expired" : (charge.failureReason ?? "declined");
  const changed = await withOrg(orgId, (tx) => failPayment(tx, p.id as string, reason, now));
  return { status: 200, body: { result: changed ? "failed" : "ignored" } };
}
