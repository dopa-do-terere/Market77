const digits = (s: string) => s.replace(/\D/g, "");
const allSame = (d: string) => /^(\d)\1+$/.test(d);

function cpfDigit(n: number[], len: number): number {
  const sum = n.slice(0, len).reduce((a, x, i) => a + x * (len + 1 - i), 0);
  return ((sum * 10) % 11) % 10;
}

/** The 11 digits of a valid CPF, or null. */
export function normalizeCpf(input: string): string | null {
  const d = digits(input);
  if (d.length !== 11 || allSame(d)) return null;
  const n = [...d].map(Number);
  return cpfDigit(n, 9) === n[9] && cpfDigit(n, 10) === n[10] ? d : null;
}

const W1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const W2 = [6, ...W1];

function cnpjDigit(n: number[], w: number[]): number {
  const r = w.reduce((a, x, i) => a + x * n[i], 0) % 11;
  return r < 2 ? 0 : 11 - r;
}

/** The 14 digits of a valid CNPJ, or null. */
export function normalizeCnpj(input: string): string | null {
  const d = digits(input);
  if (d.length !== 14 || allSame(d)) return null;
  const n = [...d].map(Number);
  return cnpjDigit(n, W1) === n[12] && cnpjDigit(n, W2) === n[13] ? d : null;
}

/** 52998224725 -> ***.982.247-** */
export function maskCpf(cpf: string): string {
  return `***.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-**`;
}
