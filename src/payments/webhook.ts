import { adminSql } from "@/db/client";
import { withOrg } from "@/db/tenant";
import { confirmPayment, failPayment } from "@/domain/payments";
import type { CardProvider } from "./card";
import type { PaymentProvider } from "./provider";
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
