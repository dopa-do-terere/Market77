import { describe, expect, it } from "vitest";
import type { PaymentProvider } from "@/payments/provider";

export type ProviderHarness = {
  provider: PaymentProvider;
  /** Makes the provider settle the charge and returns the signed webhook it would send. */
  settle(externalId: string): { headers: Headers; rawBody: string };
  /** A webhook for the charge whose signature is wrong. */
  forged(externalId: string): { headers: Headers; rawBody: string };
};

/** Every payment adapter must pass this suite (the real one runs it against its sandbox). */
export function paymentProviderContract(name: string, make: () => ProviderHarness) {
  describe(`payment provider contract: ${name}`, () => {
    const expiresAt = new Date("2026-10-02T12:03:00Z");
    const charge = (h: ProviderHarness) =>
      h.provider.createPixCharge({ saleId: "sale-1", amountCents: 1000, expiresAt });

    it("creates a charge with an id and a Pix payload", async () => {
      const c = await charge(make());
      expect(c.externalId).not.toBe("");
      expect(c.qrPayload).not.toBe("");
      expect(c.expiresAt).toEqual(expiresAt);
    });

    it("reports a new charge as pending with the charged amount", async () => {
      const h = make();
      const c = await charge(h);
      expect(await h.provider.getCharge(c.externalId)).toEqual({ status: "pending", amountCents: 1000 });
    });

    it("reports a settled charge as confirmed", async () => {
      const h = make();
      const c = await charge(h);
      h.settle(c.externalId);
      expect((await h.provider.getCharge(c.externalId)).status).toBe("confirmed");
    });

    it("parses a genuine webhook into an event", async () => {
      const h = make();
      const c = await charge(h);
      const { headers, rawBody } = h.settle(c.externalId);
      expect(h.provider.parseWebhook(headers, rawBody)).toEqual({
        externalId: c.externalId,
        status: "confirmed",
        amountCents: 1000,
      });
    });

    it("rejects a webhook with an invalid signature", async () => {
      const h = make();
      const c = await charge(h);
      const { headers, rawBody } = h.forged(c.externalId);
      expect(() => h.provider.parseWebhook(headers, rawBody)).toThrow();
    });

    it("rejects getCharge for an unknown charge", async () => {
      await expect(make().provider.getCharge("does-not-exist")).rejects.toThrow();
    });
  });
}
