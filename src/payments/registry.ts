import type { CardProvider } from "./card";
import { fakeProvider } from "./fake";
import { fakeCardProvider } from "./fake-card";
import type { PaymentProvider } from "./provider";

const PROVIDERS: Record<string, PaymentProvider> = { fake: fakeProvider };
const CARD_PROVIDERS: Record<string, CardProvider> = { fake: fakeCardProvider };

// ponytail: one global provider chosen by env. Per-organization selection arrives with provider_credentials.
export function getProvider(name: string = process.env.PIX_PROVIDER ?? "fake"): PaymentProvider {
  // hasOwn: the name comes from a URL, so "constructor" must not resolve to Object.prototype members.
  if (!Object.hasOwn(PROVIDERS, name)) throw new Error(`Unknown Pix provider: ${name}`);
  return PROVIDERS[name];
}

export function getCardProvider(name: string = process.env.CARD_PROVIDER ?? "fake"): CardProvider {
  if (!Object.hasOwn(CARD_PROVIDERS, name)) throw new Error(`Unknown card provider: ${name}`);
  return CARD_PROVIDERS[name];
}
