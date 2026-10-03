import { beforeEach, describe, expect, it } from "vitest";
import { adminSql } from "@/db/client";
import { withOrg } from "@/db/tenant";
import {
  allocateFefo,
  getOrCreateLot,
  isFullyExpired,
  isRealDay,
  listLotBalances,
  planFefo,
  plusDays,
  todayBR,
} from "@/domain/lots";
import { addLot, makeOrg, resetDb, seedMarketProduct, track } from "../helpers";

beforeEach(resetDb);

describe("dates", () => {
  it("uses the civil date in Sao Paulo, not UTC", () => {
    expect(todayBR(new Date("2026-10-03T02:59:00Z"))).toBe("2026-10-02");
    expect(todayBR(new Date("2026-10-03T03:00:00Z"))).toBe("2026-10-03");
  });

  it("adds days across month ends and validates real dates", () => {
    expect(plusDays("2026-10-30", 3)).toBe("2026-11-02");
    expect(isRealDay("2026-02-28")).toBe(true);
    expect(isRealDay("2026-02-30")).toBe(false);
    expect(isRealDay("26-02-01")).toBe(false);
  });
});

describe("planFefo", () => {
  const lot = (id: string, balance: number) => ({ id, expiresOn: "2026-12-01", balance });

  it("takes the earliest lot first and spans lots", () => {
    expect(planFefo([lot("a", 5)], 3)).toEqual([{ lotId: "a", quantity: 3 }]);
    expect(planFefo([lot("a", 2), lot("b", 5)], 4)).toEqual([
      { lotId: "a", quantity: 2 },
      { lotId: "b", quantity: 2 },
    ]);
    expect(planFefo([lot("a", 3)], 3)).toEqual([{ lotId: "a", quantity: 3 }]);
  });

  it("sends the shortfall to no lot and skips empty or negative lots", () => {
    expect(planFefo([lot("a", 2)], 5)).toEqual([
      { lotId: "a", quantity: 2 },
      { lotId: null, quantity: 3 },
    ]);
    expect(planFefo([], 4)).toEqual([{ lotId: null, quantity: 4 }]);
    expect(planFefo([lot("a", 0), lot("b", -2), lot("c", 5)], 2)).toEqual([{ lotId: "c", quantity: 2 }]);
    expect(planFefo([lot("a", 2)], 0)).toEqual([]);
  });
});

describe("lots in the database", () => {
  async function tracked() {
    const orgId = await makeOrg("A");
    const s = await seedMarketProduct(orgId);
    await track(s.marketProductId);
    return { orgId, mp: s.marketProductId };
  }

  it("reuses the lot of the same date and creates another for a new date", async () => {
    const { orgId, mp } = await tracked();
    const a = await withOrg(orgId, (tx) => getOrCreateLot(tx, orgId, mp, "2026-12-01"));
    const b = await withOrg(orgId, (tx) => getOrCreateLot(tx, orgId, mp, "2026-12-01"));
    const c = await withOrg(orgId, (tx) => getOrCreateLot(tx, orgId, mp, "2026-12-02"));
    expect(b).toBe(a);
    expect(c).not.toBe(a);
  });

  it("lists lot balances by expiry and allocates from the earliest", async () => {
    const { orgId, mp } = await tracked();
    await addLot(orgId, mp, "2026-12-20", 5);
    await addLot(orgId, mp, "2026-12-10", 2);
    const lots = await withOrg(orgId, (tx) => listLotBalances(tx, mp));
    expect(lots.map((l) => [l.expiresOn, l.balance])).toEqual([
      ["2026-12-10", 2],
      ["2026-12-20", 5],
    ]);
    const plan = await withOrg(orgId, (tx) => allocateFefo(tx, mp, 4));
    expect(plan).toEqual([
      { lotId: lots[0].id, quantity: 2 },
      { lotId: lots[1].id, quantity: 2 },
    ]);
  });

  it("counts a product as fully expired only when valid stock is gone", async () => {
    const { orgId, mp } = await tracked();
    const today = "2026-10-03";
    const check = () => withOrg(orgId, (tx) => isFullyExpired(tx, mp, today));
    expect(await check()).toBe(false); // no lots at all
    await addLot(orgId, mp, "2026-10-02", 3); // expired yesterday
    expect(await check()).toBe(true);
    await addLot(orgId, mp, "2026-10-03", 1); // valid through today
    expect(await check()).toBe(false);
    await adminSql`insert into stock_movements (org_id, market_product_id, type, quantity)
      values (${orgId}, ${mp}, 'loss', -1)`; // booked without a lot
    expect(await check()).toBe(true); // valid = 1 (today's lot) + (-1) (no lot) = 0, expired = 3
  });
});
