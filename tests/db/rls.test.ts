import postgres from "postgres";
import { beforeEach, describe, expect, it } from "vitest";
import { adminSql } from "@/db/client";
import { withOrg } from "@/db/tenant";
import { makeOrg, resetDb, seedMarketProduct } from "../helpers";

beforeEach(resetDb);

describe("row level security", () => {
  it("isolates markets per tenant", async () => {
    const a = await makeOrg("A");
    const b = await makeOrg("B");
    await withOrg(a, (tx) => tx`insert into markets (org_id, name) values (${a}, 'Loja A')`);
    await withOrg(b, (tx) => tx`insert into markets (org_id, name) values (${b}, 'Loja B')`);
    const seen = await withOrg(a, (tx) => tx`select name from markets`);
    expect(seen.map((r) => r.name)).toEqual(["Loja A"]);
  });

  it("rejects writing a row that belongs to another org", async () => {
    const a = await makeOrg("A");
    const b = await makeOrg("B");
    await expect(
      withOrg(a, (tx) => tx`insert into markets (org_id, name) values (${b}, 'x')`),
    ).rejects.toThrow(/row-level security/);
  });

  it("sees nothing, without error, on a reused connection after withOrg", async () => {
    const a = await makeOrg("A");
    await adminSql`insert into markets (org_id, name) values (${a}, 'Loja A')`;
    // single-connection pool guarantees the same connection serves both calls
    const pool = postgres(process.env.DATABASE_APP_URL!, { max: 1 });
    try {
      await pool.begin(async (tx) => {
        await tx`select set_config('app.org_id', ${a}, true)`;
        const rows = await tx`select * from markets`;
        expect(rows).toHaveLength(1);
      });
      const afterwards = await pool`select * from markets`;
      expect(afterwards).toHaveLength(0);
    } finally {
      await pool.end();
    }
  });

  it("blocks a foreign key that points at another tenant's row", async () => {
    const a = await makeOrg("A");
    const b = await makeOrg("B");
    const theirs = await seedMarketProduct(b);
    const mine = await seedMarketProduct(a);
    await expect(
      withOrg(a, (tx) => tx`
        insert into market_products (org_id, market_id, product_id, price_cents)
        values (${a}, ${theirs.marketId}, ${mine.productId}, 100)`),
    ).rejects.toThrow(/foreign key/);
  });

  it("keeps stock_movements append-only for the app role", async () => {
    const a = await makeOrg("A");
    const { marketProductId } = await seedMarketProduct(a);
    await withOrg(a, (tx) => tx`
      insert into stock_movements (org_id, market_product_id, type, quantity)
      values (${a}, ${marketProductId}, 'in', 5)`);
    await expect(withOrg(a, (tx) => tx`update stock_movements set quantity = 1`)).rejects.toThrow(
      /permission denied/,
    );
    await expect(withOrg(a, (tx) => tx`delete from stock_movements`)).rejects.toThrow(
      /permission denied/,
    );
  });

  it("enforces the sign of each movement type", async () => {
    const a = await makeOrg("A");
    const { marketProductId } = await seedMarketProduct(a);
    const insert = (type: string, quantity: number) =>
      withOrg(a, (tx) => tx`
        insert into stock_movements (org_id, market_product_id, type, quantity)
        values (${a}, ${marketProductId}, ${type}, ${quantity})`);
    await expect(insert("in", -1)).rejects.toThrow(/check constraint/);
    await expect(insert("sale", 1)).rejects.toThrow(/check constraint/);
    await expect(insert("adjustment", -3)).resolves.toBeDefined();
  });
});
