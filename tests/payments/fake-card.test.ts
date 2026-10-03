import { afterEach, describe, expect, it, vi } from "vitest";
import { buildFakeCardWebhook, fakeCardProvider } from "@/payments/fake-card";
import { getCardProvider } from "@/payments/registry";
import { cardProviderContract } from "./card-contract";

afterEach(() => vi.unstubAllEnvs());

cardProviderContract("fake-card", () => ({
  provider: fakeCardProvider,
  approve: (id) => buildFakeCardWebhook(id, { status: "confirmed" }),
  decline: (id) => buildFakeCardWebhook(id, { status: "failed", failureReason: "declined" }),
  forged: (id) => ({
    headers: new Headers({ "x-fake-signature": "00" }),
    rawBody: JSON.stringify({ externalId: id, status: "confirmed", amountCents: 1 }),
  }),
}));

describe("fake card provider guards", () => {
  const args = { saleId: "s", amountCents: 100, terminalId: "t", expiresAt: new Date() };

  it("refuses to run in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(fakeCardProvider.createCardCharge(args)).rejects.toThrow(/production/);
  });

  it("refuses to run without a webhook secret", async () => {
    vi.stubEnv("FAKE_CARD_SECRET", "");
    await expect(fakeCardProvider.createCardCharge(args)).rejects.toThrow(/FAKE_CARD_SECRET/);
  });
});

describe("card provider registry", () => {
  it("returns the fake provider by default and by name", () => {
    expect(getCardProvider().name).toBe("fake");
    expect(getCardProvider("fake")).toBe(fakeCardProvider);
  });

  it.each(["nope", "constructor", "__proto__", "toString"])("rejects the unknown provider %s", (name) => {
    expect(() => getCardProvider(name)).toThrow(/Unknown card provider/);
  });
});
