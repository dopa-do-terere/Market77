import type { Tx } from "@/db/tenant";
import { readOwnMercadoPagoCredentials } from "@/domain/credentials";
import { AppError } from "@/lib/errors";
import type { CardProvider } from "./card";
import { fakeProvider } from "./fake";
import { fakeCardProvider } from "./fake-card";
import type { Fetch } from "./mercadopago-http";
import { mercadoPagoPoint } from "./mercadopago-card";
import { mercadoPagoPix } from "./mercadopago-pix";
import type { PaymentProvider } from "./provider";

// By-name registries serve the dev routes and the old webhook URLs: only the simulator is in them.
const PROVIDERS: Record<string, PaymentProvider> = { fake: fakeProvider };
const CARD_PROVIDERS: Record<string, CardProvider> = { fake: fakeCardProvider };

export function getProvider(name: string = "fake"): PaymentProvider {
  // hasOwn: the name comes from a URL, so "constructor" must not resolve to Object.prototype members.
  if (!Object.hasOwn(PROVIDERS, name)) throw new Error(`Unknown Pix provider: ${name}`);
  return PROVIDERS[name];
}

export function getCardProvider(name: string = "fake"): CardProvider {
  if (!Object.hasOwn(CARD_PROVIDERS, name)) throw new Error(`Unknown card provider: ${name}`);
  return CARD_PROVIDERS[name];
}

/** The organization of the transaction (RLS). Failing to read or decrypt is "provider unavailable". */
async function credentialsOf(tx: Tx) {
  try {
    return await readOwnMercadoPagoCredentials(tx);
  } catch {
    throw new AppError("provider_unavailable");
  }
}

/**
 * Pix provider of the organization: Mercado Pago when it connected an account, else the simulator
 * (which refuses to run in production, so a production organization without credentials gets provider_unavailable).
 */
export async function resolvePix(tx: Tx, f?: Fetch): Promise<PaymentProvider> {
  const creds = await credentialsOf(tx);
  return creds ? mercadoPagoPix(creds, f) : getProvider("fake");
}

/** Card provider of the organization; the Point machine comes from the totem's own row. */
export async function resolveCard(tx: Tx, f?: Fetch): Promise<CardProvider> {
  const creds = await credentialsOf(tx);
  if (!creds) return getCardProvider("fake");
  return mercadoPagoPoint(
    creds,
    async (terminalId) => {
      const [t] = await tx`select point_device_id from terminals where id = ${terminalId}`;
      return (t?.point_device_id as string | null) ?? null;
    },
    f,
  );
}
