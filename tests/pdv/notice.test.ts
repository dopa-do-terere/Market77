import { describe, expect, it } from "vitest";
import { paymentNotice } from "@/pdv/notice";

const sale = (payment: { method: string; status: string } | null, paymentFailure: { method: string; reason: string } | null) => ({
  payment,
  paymentFailure,
});

describe("paymentNotice", () => {
  it("tells the customer a card was declined and how to go on", () => {
    expect(paymentNotice(sale({ method: "card", status: "failed" }, { method: "card", reason: "declined" }))).toBe(
      "Cartão recusado. Tente de novo ou pague com Pix.",
    );
  });

  it("tells the customer the time on the machine ran out", () => {
    expect(paymentNotice(sale({ method: "card", status: "expired" }, { method: "card", reason: "expired" }))).toBe(
      "Tempo esgotado na maquininha.",
    );
  });

  it("says nothing when the customer cancelled the card payment or nothing failed", () => {
    expect(paymentNotice(sale({ method: "card", status: "expired" }, { method: "card", reason: "cancelled" }))).toBeNull();
    expect(paymentNotice(sale(null, null))).toBeNull();
    expect(paymentNotice(sale({ method: "card", status: "pending" }, null))).toBeNull();
  });

  it("keeps the Pix message for an expired QR, and ignores Pix failures of other kinds", () => {
    expect(paymentNotice(sale({ method: "pix", status: "expired" }, { method: "pix", reason: "expired" }))).toBe(
      "O QR expirou. Gere um novo para pagar.",
    );
    expect(paymentNotice(sale({ method: "pix", status: "expired" }, null))).toBe("O QR expirou. Gere um novo para pagar.");
    expect(paymentNotice(sale({ method: "pix", status: "failed" }, { method: "pix", reason: "declined" }))).toBeNull();
  });
});
