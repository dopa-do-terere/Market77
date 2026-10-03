import { expect, it } from "vitest";
import { withTimeout } from "@/payments/provider";

it("resolves a fast promise", async () => {
  expect(await withTimeout(Promise.resolve(7), 50)).toBe(7);
});

it("rejects a promise that never settles", async () => {
  await expect(withTimeout(new Promise(() => {}), 20)).rejects.toThrow("provider timeout");
});

it("passes through a rejection", async () => {
  await expect(withTimeout(Promise.reject(new Error("boom")), 50)).rejects.toThrow("boom");
});
