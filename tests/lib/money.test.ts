import { describe, expect, it } from "vitest";
import { formatBRL, parseBRL } from "@/lib/money";

describe("parseBRL", () => {
  it.each([
    ["5,90", 590],
    ["5.9", 590],
    ["10", 1000],
    ["R$ 0,05", 5],
    ["0.10", 10],
  ])("parses %s", (input, cents) => expect(parseBRL(input)).toBe(cents));

  it.each(["", "abc", "1,234", "-1", "1.234,50", "5,"])("rejects %j", (input) =>
    expect(parseBRL(input)).toBeNull(),
  );
});

describe("formatBRL", () => {
  it("formats cents as reais", () => {
    expect(formatBRL(590).replace(/\s/g, " ")).toBe("R$ 5,90");
  });
});
