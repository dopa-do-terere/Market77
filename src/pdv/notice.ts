type NoticeSale = {
  payment: { method: string; status: string } | null;
  paymentFailure: { method: string; reason: string } | null;
};

/** The message the cart shows after a payment did not go through, or null for none. */
export function paymentNotice(sale: NoticeSale): string | null {
  const f = sale.paymentFailure;
  if (f?.method === "card") {
    if (f.reason === "declined") return "Cartão recusado. Tente de novo ou pague com Pix.";
    if (f.reason === "expired") return "Tempo esgotado na maquininha.";
    return null; // the customer cancelled: no warning
  }
  if (sale.payment && sale.payment.method !== "card" && sale.payment.status === "expired") {
    return "O QR expirou. Gere um novo para pagar.";
  }
  return null;
}
