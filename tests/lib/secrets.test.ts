import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import { decryptSecret, encryptSecret } from "@/lib/secrets";

afterEach(() => vi.unstubAllEnvs());

describe("secrets", () => {
  it("round-trips and never repeats the ciphertext", () => {
    const a = encryptSecret("APP_USR-123");
    const b = encryptSecret("APP_USR-123");
    expect(a).not.toBe(b);
    expect(a.startsWith("v1:")).toBe(true);
    expect(a).not.toContain("APP_USR");
    expect(decryptSecret(a)).toBe("APP_USR-123");
  });

  it("fails on a tampered blob", () => {
    const parts = encryptSecret("segredo").split(":");
    parts[3] = Buffer.from("outro").toString("base64");
    expect(() => decryptSecret(parts.join(":"))).toThrow();
  });

  it("fails on a malformed blob", () => {
    expect(() => decryptSecret("lixo")).toThrow();
  });

  it("refuses to work without a valid key", () => {
    for (const bad of ["", Buffer.alloc(16).toString("base64")]) {
      vi.stubEnv("CREDENTIALS_KEY", bad);
      expect(() => encryptSecret("x")).toThrow(AppError);
      try {
        encryptSecret("x");
      } catch (e) {
        expect((e as AppError).code).toBe("credentials_key_missing");
      }
    }
  });
});
