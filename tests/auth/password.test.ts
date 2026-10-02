import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/auth/password";

describe("password", () => {
  it("verifies the right password and rejects the wrong one", async () => {
    const stored = await hashPassword("segredo-123");
    expect(await verifyPassword("segredo-123", stored)).toBe(true);
    expect(await verifyPassword("outra-senha", stored)).toBe(false);
  });

  it("uses a random salt", async () => {
    expect(await hashPassword("x1234567")).not.toBe(await hashPassword("x1234567"));
  });

  it("rejects malformed stored values instead of throwing", async () => {
    expect(await verifyPassword("x", "lixo")).toBe(false);
    expect(await verifyPassword("x", "")).toBe(false);
  });
});
