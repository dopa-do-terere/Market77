import { describe, expect, it } from "vitest";
import { can } from "@/auth/permissions";

describe("can", () => {
  it("lets the owner do everything", () => {
    for (const a of ["member:write", "market:write", "product:write", "price:write", "stock:move"] as const) {
      expect(can("owner", a)).toBe(true);
    }
  });

  it("lets the manager manage catalog and stock but not markets or members", () => {
    expect(can("manager", "product:write")).toBe(true);
    expect(can("manager", "price:write")).toBe(true);
    expect(can("manager", "market:write")).toBe(false);
    expect(can("manager", "member:write")).toBe(false);
  });

  it("lets the restocker move stock only", () => {
    expect(can("restocker", "stock:move")).toBe(true);
    expect(can("restocker", "stock:read")).toBe(true);
    expect(can("restocker", "price:write")).toBe(false);
    expect(can("restocker", "product:write")).toBe(false);
  });
});

describe("phase 2 permissions", () => {
  it("lets only the owner manage terminals", () => {
    expect(can("owner", "terminal:write")).toBe(true);
    expect(can("manager", "terminal:write")).toBe(false);
    expect(can("restocker", "terminal:write")).toBe(false);
  });

  it("lets the owner and the manager read sales, not the restocker", () => {
    expect(can("owner", "sale:read")).toBe(true);
    expect(can("manager", "sale:read")).toBe(true);
    expect(can("restocker", "sale:read")).toBe(false);
  });
});
