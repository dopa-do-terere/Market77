import { beforeEach, describe, expect, it } from "vitest";
import { withOrg } from "@/db/tenant";
import { setMarketProduct } from "@/domain/market-products";
import { getBalance, listLowStock, recordMovement } from "@/domain/stock";
import { AppError } from "@/lib/errors";
import { makeOrg, resetDb, seedMarketProduct } from "../helpers";

beforeEach(resetDb);

const codeOf = async (p: Promise<unknown>) => ((await p.catch((e) => e)) as AppError).code;
const move = (orgId: string, marketProductId: string, type: string, quantity: number) =>
  withOrg(orgId, (tx) => recordMovement(tx, orgId, null, { marketProductId, type, quantity }));

describe("stock ledger", () => {
  it("computes the balance from signed movements", async () => {
    const a = await makeOrg("A");
    const { marketProductId: mp } = await seedMarketProduct(a);
    await move(a, mp, "in", 10);
    await move(a, mp, "sale", 3);
    await move(a, mp, "loss", 2);
    expect(await withOrg(a, (tx) => getBalance(tx, mp))).toBe(5);
    await move(a, mp, "adjustment", -4);
    expect(await withOrg(a, (tx) => getBalance(tx, mp))).toBe(1);
  });

  it("rejects negative or zero quantities for in/sale/loss and zero for adjustment", async () => {
    const a = await makeOrg("A");
    const { marketProductId: mp } = await seedMarketProduct(a);
    expect(await codeOf(move(a, mp, "sale", -1))).toBe("invalid_input");
    expect(await codeOf(move(a, mp, "in", 0))).toBe("invalid_input");
    expect(await codeOf(move(a, mp, "adjustment", 0))).toBe("invalid_input");
    expect(await codeOf(move(a, mp, "in", 1.5))).toBe("invalid_input");
  });

  it("returns not_found for unknown or other-tenant market products", async () => {
    const a = await makeOrg("A");
    const b = await makeOrg("B");
    const theirs = await seedMarketProduct(b);
    expect(await codeOf(move(a, theirs.marketProductId, "in", 1))).toBe("not_found");
    expect(await codeOf(move(a, "00000000-0000-4000-8000-000000000000", "in", 1))).toBe("not_found");
  });

  it("keeps an exact balance under concurrent sales", async () => {
    const a = await makeOrg("A");
    const { marketProductId: mp } = await seedMarketProduct(a);
    await move(a, mp, "in", 50);
    await Promise.all(Array.from({ length: 20 }, () => move(a, mp, "sale", 1)));
    expect(await withOrg(a, (tx) => getBalance(tx, mp))).toBe(30);
  });

  it("lists active products at or below the minimum", async () => {
    const a = await makeOrg("A");
    const { marketId, productId, marketProductId: mp } = await seedMarketProduct(a);
    await withOrg(a, (tx) => setMarketProduct(tx, a, { marketId, productId, priceCents: 500, minStock: 5 }));
    await move(a, mp, "in", 5);
    expect((await withOrg(a, (tx) => listLowStock(tx, marketId))).map((r) => r.id)).toEqual([mp]);
    await move(a, mp, "in", 1);
    expect(await withOrg(a, (tx) => listLowStock(tx, marketId))).toEqual([]);
    await move(a, mp, "loss", 6);
    await withOrg(a, (tx) => setMarketProduct(tx, a, { marketId, productId, priceCents: 500, minStock: 5, active: false }));
    expect(await withOrg(a, (tx) => listLowStock(tx, marketId))).toEqual([]);
  });

  it("rejects quantity exceeding max integer", async () => {
    const a = await makeOrg("A");
    const { marketProductId: mp } = await seedMarketProduct(a);
    expect(await codeOf(move(a, mp, "in", 2147483648))).toBe("invalid_input");
  });
});
