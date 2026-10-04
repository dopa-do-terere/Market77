import { describe, expect, it } from "vitest";
import type { FiscalPayload, FiscalProvider } from "@/fiscal/provider";

export const samplePayload: FiscalPayload = {
  emitter: { cnpj: "12345678000195", stateRegistration: "123456789", uf: "SP", series: 1, regime: "simples" },
  customer: null,
  items: [
    {
      description: "Água",
      ncm: "22021000",
      cest: null,
      cfop: "5102",
      csosn: "102",
      unit: "UN",
      origin: 0,
      quantity: 2,
      unitPriceCents: 500,
      totalCents: 1000,
    },
  ],
  totalCents: 1000,
  paymentMethod: "pix",
  paidAt: "2026-10-03T15:00:00.000Z",
};

/** Every fiscal adapter must pass this suite (the real one runs it against its sandbox). */
export function fiscalProviderContract(name: string, make: () => FiscalProvider) {
  describe(`fiscal provider contract: ${name}`, () => {
    it("issues a note with a number, a 44-digit access key and a DANFE link", async () => {
      const n = await make().issueNfce("ref-1", samplePayload);
      expect(n.externalId).not.toBe("");
      expect(n.number).toBeGreaterThan(0);
      expect(n.accessKey).toMatch(/^\d{44}$/);
      expect(n.danfeUrl).toMatch(/^https?:\/\//);
    });

    it("is idempotent: the same ref returns the same note", async () => {
      const p = make();
      const a = await p.issueNfce("ref-1", samplePayload);
      const b = await p.issueNfce("ref-1", samplePayload);
      expect(b).toEqual(a);
    });

    it("gives different refs different numbers and keys", async () => {
      const p = make();
      const a = await p.issueNfce("ref-1", samplePayload);
      const b = await p.issueNfce("ref-2", samplePayload);
      expect(b.number).not.toBe(a.number);
      expect(b.accessKey).not.toBe(a.accessKey);
    });

    it("finds an issued note by ref and returns null for an unknown ref", async () => {
      const p = make();
      const a = await p.issueNfce("ref-1", samplePayload);
      expect(await p.getByRef("ref-1")).toEqual(a);
      expect(await p.getByRef("never-issued")).toBeNull();
    });
  });
}
