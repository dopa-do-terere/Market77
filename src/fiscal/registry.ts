import { AppError } from "@/lib/errors";
import { fakeFiscalProvider } from "./fake-fiscal";
import type { FiscalProvider } from "./provider";

const PROVIDERS: Record<string, FiscalProvider> = { fake: fakeFiscalProvider };

// ponytail: one global provider chosen by env. Per-organization selection arrives with provider_credentials.
export function getFiscalProvider(name: string = process.env.FISCAL_PROVIDER ?? "fake"): FiscalProvider {
  // hasOwn: the name may come from outside, so "constructor" must not resolve to Object.prototype members.
  if (!Object.hasOwn(PROVIDERS, name)) throw new AppError("provider_unavailable");
  return PROVIDERS[name];
}
