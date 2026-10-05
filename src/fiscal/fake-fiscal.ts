import { createHash } from "node:crypto";
import { FiscalRejected, FiscalUnavailable, type FiscalIssued, type FiscalProvider } from "./provider";

export type FakeFiscalMode = "ok" | "down" | "reject" | "lost";

// ponytail: state lives in memory, for dev and tests only. A real adapter asks its provider instead.
const g = globalThis as unknown as {
  __m77fakeFiscal?: { mode: FakeFiscalMode; next: number; byRef: Map<string, FiscalIssued> };
};
const state = (g.__m77fakeFiscal ??= { mode: "ok", next: 1, byRef: new Map() });

function guard(): void {
  if (process.env.NODE_ENV === "production") throw new Error("fake fiscal provider is disabled in production");
}

export function setFakeFiscalMode(mode: FakeFiscalMode): void {
  guard();
  state.mode = mode;
}

/** Tests: forget every note, restart the numbering and go back to "ok". */
export function resetFakeFiscal(): void {
  guard();
  state.mode = "ok";
  state.next = 1;
  state.byRef.clear();
}

function make(ref: string): FiscalIssued {
  const accessKey = BigInt(`0x${createHash("sha256").update(ref).digest("hex")}`)
    .toString()
    .padStart(44, "0")
    .slice(0, 44);
  return {
    externalId: `fakenfce_${ref}`,
    number: state.next++,
    accessKey,
    danfeUrl: `https://fake-nfce.invalid/danfe/${accessKey}`,
  };
}

export const fakeFiscalProvider: FiscalProvider = {
  name: "fake",

  async issueNfce(ref) {
    guard();
    if (state.mode === "down") throw new FiscalUnavailable();
    if (state.mode === "reject") throw new FiscalRejected("fake_rejected", "Rejeição simulada.");
    const issued = state.byRef.get(ref) ?? make(ref);
    state.byRef.set(ref, issued);
    if (state.mode === "lost") throw new FiscalUnavailable("response lost");
    return issued;
  },

  async getByRef(ref) {
    guard();
    if (state.mode === "down") throw new FiscalUnavailable();
    return state.byRef.get(ref) ?? null;
  },
};
