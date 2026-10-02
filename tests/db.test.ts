import { describe, expect, it } from "vitest";
import { adminSql } from "@/db/client";

describe("database", () => {
  it("connects to the test database", async () => {
    const [r] = await adminSql`select current_database() as db`;
    expect(r.db).toBe("market77_test");
  });
});
