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

  it("fails on a tampered tag, a short tag, a wrong iv length or extra parts", () => {
    const [v, iv, tag, data] = encryptSecret("segredo").split(":");
    const b64 = (n: number) => Buffer.alloc(n, 1).toString("base64");
    const bad = [
      [v, iv, b64(16), data],
      [v, iv, Buffer.from(tag, "base64").subarray(0, 4).toString("base64"), data],
      [v, b64(8), tag, data],
      [v, iv, tag, data, "x"],
    ];
    for (const p of bad) expect(() => decryptSecret(p.join(":"))).toThrow();
    for (const p of bad.slice(1)) expect(() => decryptSecret(p.join(":"))).toThrow("malformed secret");
  });

  it("fails on a malformed blob", () => {
    expect(() => decryptSecret("lixo")).toThrow();
  });

  it("decrypt without a key throws credentials_key_missing", () => {
    const blob = encryptSecret("x");
    vi.stubEnv("CREDENTIALS_KEY", "");
    expect(() => decryptSecret(blob)).toThrow(AppError);
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
