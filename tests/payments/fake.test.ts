import { afterEach, describe, expect, it, vi } from "vitest";
import { buildFakeWebhook, fakeProvider } from "@/payments/fake";
import { getProvider } from "@/payments/registry";
import { paymentProviderContract } from "./contract";

afterEach(() => vi.unstubAllEnvs());

paymentProviderContract("fake", () => ({
  provider: fakeProvider,
  settle: (id) => buildFakeWebhook(id, { status: "confirmed" }),
  forged: (id) => ({
    headers: new Headers({ "x-fake-signature": "00" }),
    rawBody: JSON.stringify({ externalId: id, status: "confirmed", amountCents: 1 }),
  }),
}));

describe("fake provider guards", () => {
  const args = { saleId: "s", amountCents: 100, expiresAt: new Date() };

  it("refuses to run in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(fakeProvider.createPixCharge(args)).rejects.toThrow(/production/);
  });

  it("refuses to run without a webhook secret", async () => {
    vi.stubEnv("FAKE_PIX_SECRET", "");
    await expect(fakeProvider.createPixCharge(args)).rejects.toThrow(/FAKE_PIX_SECRET/);
  });
});

describe("provider registry", () => {
  it("returns the fake provider by default and by name", () => {
    expect(getProvider().name).toBe("fake");
    expect(getProvider("fake")).toBe(fakeProvider);
  });

  it.each(["nope", "constructor", "__proto__", "toString"])("rejects the unknown provider %s", (name) => {
    expect(() => getProvider(name)).toThrow(/Unknown Pix provider/);
  });
});
