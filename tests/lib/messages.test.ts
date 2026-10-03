import { describe, expect, it } from "vitest";
import { message } from "@/lib/messages";

const CODES = [
  "unauthorized", "terminal_revoked", "product_not_found", "product_inactive", "sale_not_found",
  "sale_not_editable", "sale_empty", "sale_too_large", "quantity_limit", "provider_unavailable",
  "payment_failed",
];

describe("phase 2 messages", () => {
  it.each(CODES)("has a Portuguese message for %s", (code) => {
    expect(message(code)).not.toBe("Erro inesperado.");
  });
});
