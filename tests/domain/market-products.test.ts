import { beforeEach, describe, expect, it } from "vitest";
import { withOrg } from "@/db/tenant";
import { listMarketProducts, setMarketProduct } from "@/domain/market-products";
import { AppError } from "@/lib/errors";
import { makeOrg, resetDb, seedMarketProduct } from "../helpers";

beforeEach(resetDb);

const codeOf = async (p: Promise<unknown>) => ((await p.catch((e) => e)) as AppError).code;

describe("market products", () => {
  it("upserts price and min stock for the same market and product", async () => {
    const a = await makeOrg("A");
    const { marketId, productId, marketProductId } = await seedMarketProduct(a, 500);
    const r = await withOrg(a, (tx) => setMarketProduct(tx, a, { marketId, productId, priceCents: 650, minStock: 4 }));
    expect(r.id).toBe(marketProductId);
    const [row] = await withOrg(a, (tx) => listMarketProducts(tx, marketId));
    expect([row.priceCents, row.minStock, row.balance]).toEqual([650, 4, 0]);
  });

  it.each([0, -5, 5.5])("rejects price %s", async (priceCents) => {
    const a = await makeOrg("A");
    const { marketId, productId } = await seedMarketProduct(a);
    expect(await codeOf(withOrg(a, (tx) => setMarketProduct(tx, a, { marketId, productId, priceCents })))).toBe("invalid_input");
  });

  it("rejects priceCents exceeding max integer", async () => {
    const a = await makeOrg("A");
    const { marketId, productId } = await seedMarketProduct(a);
    expect(await codeOf(withOrg(a, (tx) => setMarketProduct(tx, a, { marketId, productId, priceCents: 2147483648 })))).toBe("invalid_input");
  });

  it("returns not_found when the market belongs to another tenant", async () => {
    const a = await makeOrg("A");
    const b = await makeOrg("B");
    const mine = await seedMarketProduct(a);
    const theirs = await seedMarketProduct(b);
    expect(
      await codeOf(withOrg(a, (tx) => setMarketProduct(tx, a, { marketId: theirs.marketId, productId: mine.productId, priceCents: 100 }))),
    ).toBe("not_found");
  });

  it("returns not_found on cross-tenant upsert attempt and leaves other tenant data unchanged", async () => {
    const a = await makeOrg("A");
    const b = await makeOrg("B");
    const theirs = await seedMarketProduct(b, 500);
    expect(
      await codeOf(withOrg(a, (tx) => setMarketProduct(tx, a, { marketId: theirs.marketId, productId: theirs.productId, priceCents: 999 }))),
    ).toBe("not_found");
    const [row] = await withOrg(b, (tx) => listMarketProducts(tx, theirs.marketId));
    expect(row.priceCents).toBe(500);
  });
});
