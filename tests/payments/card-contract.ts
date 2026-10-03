import { describe, expect, it } from "vitest";
import type { CardProvider } from "@/payments/card";

export type CardHarness = {
  provider: CardProvider;
  /** The customer approves on the machine; returns the signed webhook the provider would send. */
  approve(externalId: string): { headers: Headers; rawBody: string };
  /** The card is declined; returns the signed webhook. */
  decline(externalId: string): { headers: Headers; rawBody: string };
  /** A webhook for the charge whose signature is wrong. */
  forged(externalId: string): { headers: Headers; rawBody: string };
};

/** Every card adapter must pass this suite (the real one runs it against its sandbox). */
export function cardProviderContract(name: string, make: () => CardHarness) {
  describe(`card provider contract: ${name}`, () => {
    const expiresAt = new Date("2026-10-03T12:02:00Z");
    const charge = (h: CardHarness) =>
      h.provider.createCardCharge({ saleId: "sale-1", amountCents: 1000, terminalId: "terminal-1", expiresAt });

    it("creates a charge with an id and keeps the expiry", async () => {
      const c = await charge(make());
      expect(c.externalId).not.toBe("");
      expect(c.expiresAt).toEqual(expiresAt);
    });

    it("reports a new charge as pending with the charged amount", async () => {
      const h = make();
      const c = await charge(h);
      expect(await h.provider.getCharge(c.externalId)).toEqual({ status: "pending", amountCents: 1000 });
    });

    it("reports an approved charge as confirmed", async () => {
      const h = make();
      const c = await charge(h);
      h.approve(c.externalId);
      expect((await h.provider.getCharge(c.externalId)).status).toBe("confirmed");
    });

    it("reports a declined charge as failed with the reason", async () => {
      const h = make();
      const c = await charge(h);
      h.decline(c.externalId);
      expect(await h.provider.getCharge(c.externalId)).toEqual({
        status: "failed",
        amountCents: 1000,
        failureReason: "declined",
      });
    });

    it("cancels a pending charge, idempotently, and reports it as failed cancelled", async () => {
      const h = make();
      const c = await charge(h);
      await h.provider.cancelCardCharge(c.externalId);
      await h.provider.cancelCardCharge(c.externalId);
      expect(await h.provider.getCharge(c.externalId)).toEqual({
        status: "failed",
        amountCents: 1000,
        failureReason: "cancelled",
      });
    });

    it("never cancels a charge that was already approved", async () => {
      const h = make();
      const c = await charge(h);
      h.approve(c.externalId);
      await h.provider.cancelCardCharge(c.externalId);
      expect((await h.provider.getCharge(c.externalId)).status).toBe("confirmed");
    });

    it("parses genuine webhooks into events", async () => {
      const h = make();
      const c = await charge(h);
      const ok = h.approve(c.externalId);
      expect(h.provider.parseWebhook(ok.headers, ok.rawBody)).toEqual({
        externalId: c.externalId,
        status: "confirmed",
        amountCents: 1000,
      });
      const d = await charge(h);
      const no = h.decline(d.externalId);
      expect(h.provider.parseWebhook(no.headers, no.rawBody)).toEqual({
        externalId: d.externalId,
        status: "failed",
        amountCents: 1000,
        failureReason: "declined",
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
