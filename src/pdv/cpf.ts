/** 5299822472 -> 529.982.247-2: the CPF as typed so far, with the usual punctuation. */
export function formatCpfDraft(d: string): string {
  const a = d.slice(0, 3);
  const b = d.slice(3, 6);
  const c = d.slice(6, 9);
  const e = d.slice(9, 11);
  return [a, b && `.${b}`, c && `.${c}`, e && `-${e}`].join("");
}
