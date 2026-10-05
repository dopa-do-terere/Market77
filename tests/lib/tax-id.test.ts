import { describe, expect, it } from "vitest";
import { maskCpf, normalizeCnpj, normalizeCpf } from "@/lib/tax-id";

describe("CPF", () => {
  it("accepts a valid CPF with or without punctuation and returns the digits", () => {
    expect(normalizeCpf("52998224725")).toBe("52998224725");
    expect(normalizeCpf("529.982.247-25")).toBe("52998224725");
    expect(normalizeCpf(" 111.444.777-35 ")).toBe("11144477735");
  });

  it("rejects wrong check digits, wrong lengths, repeated digits and letters", () => {
    expect(normalizeCpf("52998224724")).toBeNull();
    expect(normalizeCpf("5299822472")).toBeNull();
    expect(normalizeCpf("529982247255")).toBeNull();
    expect(normalizeCpf("11111111111")).toBeNull();
    expect(normalizeCpf("")).toBeNull();
    expect(normalizeCpf("abc")).toBeNull();
  });

  it("masks all but the middle digits", () => {
    expect(maskCpf("52998224725")).toBe("***.982.247-**");
  });
});

describe("CNPJ", () => {
  it("accepts a valid CNPJ with or without punctuation", () => {
    expect(normalizeCnpj("12345678000195")).toBe("12345678000195");
    expect(normalizeCnpj("11.222.333/0001-81")).toBe("11222333000181");
  });

  it("rejects wrong check digits, wrong lengths and repeated digits", () => {
    expect(normalizeCnpj("12345678000190")).toBeNull();
    expect(normalizeCnpj("1234567800019")).toBeNull();
    expect(normalizeCnpj("11111111111111")).toBeNull();
    expect(normalizeCnpj("")).toBeNull();
  });
});
