import { beforeEach, describe, expect, it } from "vitest";
import { adminSql } from "@/db/client";
import { withOrg } from "@/db/tenant";
import { addLot, makeOrg, resetDb, seedMarketProduct, seedSale } from "../helpers";

beforeEach(resetDb);

describe("phase 5A schema", () => {
  it("defaults tracks_expiry to false", async () => {
    const orgId = await makeOrg("A");
    const { marketProductId } = await seedMarketProduct(orgId);
    const [row] = await adminSql`select tracks_expiry from market_products where id = ${marketProductId}`;
    expect(row.tracks_expiry).toBe(false);
  });

  it("keeps one lot per product and date", async () => {
    const orgId = await makeOrg("A");
    const { marketProductId } = await seedMarketProduct(orgId);
    await addLot(orgId, marketProductId, "2026-12-01", 0);
    await expect(addLot(orgId, marketProductId, "2026-12-01", 0)).resolves.toBeTruthy(); // helper reuses the lot
    await expect(
      adminSql`insert into stock_lots (org_id, market_product_id, expires_on)
        values (${orgId}, ${marketProductId}, '2026-12-01')`,
    ).rejects.toThrow(/duplicate key/);
  });

  it("only lets a movement point at a lot of the same product", async () => {
    const orgId = await makeOrg("A");
    const a = await seedMarketProduct(orgId);
    const b = await seedMarketProduct(orgId);
    const lot = await addLot(orgId, a.marketProductId, "2026-12-01", 0);
    await expect(
      adminSql`insert into stock_movements (org_id, market_product_id, type, quantity, lot_id)
        values (${orgId}, ${b.marketProductId}, 'in', 1, ${lot})`,
    ).rejects.toThrow(/foreign key/);
  });

  it("lets one sale take a product from two lots, but not twice from the same one", async () => {
    const orgId = await makeOrg("A");
    const { saleId } = await seedSale(orgId);
    const { marketProductId: mp } = await seedMarketProduct(orgId);
    const l1 = await addLot(orgId, mp, "2026-12-01", 0);
    const l2 = await addLot(orgId, mp, "2026-12-10", 0);
    const sale = (lotId: string | null) =>
      adminSql`insert into stock_movements (org_id, market_product_id, type, quantity, sale_id, lot_id)
        values (${orgId}, ${mp}, 'sale', -1, ${saleId}, ${lotId})`;
    await sale(l1);
    await sale(l2);
    await sale(null);
    await expect(sale(l1)).rejects.toThrow(/duplicate key/);
    await expect(sale(null)).rejects.toThrow(/duplicate key/);
  });

  it("isolates lots per tenant and keeps them append-only for the app role", async () => {
    const a = await makeOrg("A");
    const b = await makeOrg("B");
    const { marketProductId } = await seedMarketProduct(a);
    await addLot(a, marketProductId, "2026-12-01", 0);
    expect(await withOrg(b, (tx) => tx`select id from stock_lots`)).toEqual([]);
    expect(await withOrg(a, (tx) => tx`select id from stock_lots`)).toHaveLength(1);
    await expect(withOrg(a, (tx) => tx`update stock_lots set expires_on = '2027-01-01'`)).rejects.toThrow(
      /permission denied/,
    );
    await expect(withOrg(a, (tx) => tx`delete from stock_lots`)).rejects.toThrow(/permission denied/);
  });
});
