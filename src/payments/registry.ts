import { fakeProvider } from "./fake";
import type { PaymentProvider } from "./provider";

const PROVIDERS: Record<string, PaymentProvider> = { fake: fakeProvider };

// ponytail: one global provider chosen by env. Per-organization selection arrives with provider_credentials.
export function getProvider(name: string = process.env.PIX_PROVIDER ?? "fake"): PaymentProvider {
  // hasOwn: the name comes from a URL, so "constructor" must not resolve to Object.prototype members.
  if (!Object.hasOwn(PROVIDERS, name)) throw new Error(`Unknown Pix provider: ${name}`);
  return PROVIDERS[name];
}
