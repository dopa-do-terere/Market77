import { AppError } from "@/lib/errors";
import { fakeAccessProvider } from "./fake-access";
import type { AccessProvider } from "./provider";

const PROVIDERS: Record<string, AccessProvider> = { fake: fakeAccessProvider };

// ponytail: one global provider chosen by env. Per-organization selection arrives with provider_credentials.
export function getAccessProvider(name: string = process.env.ACCESS_PROVIDER ?? "fake"): AccessProvider {
  // hasOwn: the name may come from outside, so "constructor" must not resolve to Object.prototype members.
  if (!Object.hasOwn(PROVIDERS, name)) throw new AppError("provider_unavailable");
  return PROVIDERS[name];
}
