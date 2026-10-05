import { describe, expect, it } from "vitest";
import { formatCpfDraft } from "@/pdv/cpf";

describe("formatCpfDraft", () => {
  it("formats as far as the digits go", () => {
    expect(formatCpfDraft("")).toBe("");
    expect(formatCpfDraft("52")).toBe("52");
    expect(formatCpfDraft("5299")).toBe("529.9");
    expect(formatCpfDraft("5299822")).toBe("529.982.2");
    expect(formatCpfDraft("5299822472")).toBe("529.982.247-2");
    expect(formatCpfDraft("52998224725")).toBe("529.982.247-25");
  });

  it("ignores digits past the eleventh", () => {
    expect(formatCpfDraft("529982247259999")).toBe("529.982.247-25");
  });
});
