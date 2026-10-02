/** "5,90" | "5.9" | "R$ 10" to cents. No thousands separator support. Null if invalid. */
export function parseBRL(input: string): number | null {
  const s = input.trim().replace(/^R\$\s*/, "");
  if (!/^\d+([.,]\d{1,2})?$/.test(s)) return null;
  const [int, dec = ""] = s.split(/[.,]/);
  return Number(int) * 100 + Number(dec.padEnd(2, "0"));
}

export const formatBRL = (cents: number): string =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
