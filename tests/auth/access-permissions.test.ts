import { describe, expect, it } from "vitest";
import { can } from "@/auth/permissions";

describe("access permissions", () => {
  it("only the owner can read and manage the access log", () => {
    expect(can("owner", "access:read")).toBe(true);
    expect(can("owner", "access:write")).toBe(true);
    for (const role of ["manager", "restocker"] as const) {
      expect(can(role, "access:read")).toBe(false);
      expect(can(role, "access:write")).toBe(false);
    }
  });
});
