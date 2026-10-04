import { beforeEach, describe, expect, it } from "vitest";
import { adminSql } from "@/db/client";
import { withOrg } from "@/db/tenant";
import { addItemByBarcode, setItemQuantity } from "@/domain/sales";
import { addLot, codeOf, makeOrg, resetDb, seedSellable, seedStore, track } from "../helpers";

beforeEach(resetDb);

const NOW = new Date("2026-10-03T15:00:00Z"); // 2026-10-03 in Sao Paulo
const BARCODE = "7891000100103";

async function shop(tracked = true) {
  const orgId = await makeOrg("A");
  const store = await seedStore(orgId);
  const item = await seedSellable(orgId, store.marketId, { barcode: BARCODE });
  if (tracked) await track(item.marketProductId);
  return { orgId, store, mp: item.marketProductId };
}
const scan = (s: Awaited<ReturnType<typeof shop>>, now = NOW) =>
  withOrg(s.orgId, (tx) => addItemByBarcode(tx, s.orgId, s.store, { barcode: BARCODE }, now));

describe("scanning a tracked product", () => {
  it("sells it when there is no lot at all", async () => {
    expect((await scan(await shop())).items).toHaveLength(1);
  });

  it("refuses it when all the stock is in expired lots", async () => {
    const s = await shop();
    await addLot(s.orgId, s.mp, "2026-10-02", 3);
    expect(await codeOf(scan(s))).toBe("product_expired");
    expect((await adminSql`select id from sales`).length).toBe(0);
  });

  it("sells it when a valid lot exists next to an expired one", async () => {
    const s = await shop();
    await addLot(s.orgId, s.mp, "2026-10-02", 3);
    await addLot(s.orgId, s.mp, "2026-10-20", 1);
    expect((await scan(s)).items).toHaveLength(1);
  });

  it("treats a lot that expires today as still valid, and expired from the next day", async () => {
    const s = await shop();
    await addLot(s.orgId, s.mp, "2026-10-03", 3);
    expect((await scan(s)).items).toHaveLength(1);
    expect(await codeOf(scan(s, new Date("2026-10-04T03:00:00Z")))).toBe("product_expired");
  });

  it("uses the Sao Paulo midnight, not UTC, for the day boundary", async () => {
    const s = await shop();
    await addLot(s.orgId, s.mp, "2026-10-03", 3);
    // 2026-10-04T01:00Z is still 2026-10-03 22:00 in Sao Paulo
    expect((await scan(s, new Date("2026-10-04T01:00:00Z"))).items).toHaveLength(1);
  });

  it("sells it when the only stock has no lot", async () => {
    const s = await shop();
    await adminSql`insert into stock_movements (org_id, market_product_id, type, quantity)
      values (${s.orgId}, ${s.mp}, 'in', 4)`;
    expect((await scan(s)).items).toHaveLength(1);
  });

  it("does not block a product that does not track expiry", async () => {
    const s = await shop(false);
    await addLot(s.orgId, s.mp, "2026-10-02", 3);
    expect((await scan(s)).items).toHaveLength(1);
  });

  it("keeps an item that is already in the cart when its lot expires at midnight", async () => {
    const s = await shop();
    await addLot(s.orgId, s.mp, "2026-10-03", 3);
    const before = new Date("2026-10-04T02:58:00Z"); // 23:58 in Sao Paulo, lot still valid
    const after = new Date("2026-10-04T03:01:00Z"); // 00:01 the next day, lot expired
    const first = await scan(s, before);
    const view = await withOrg(s.orgId, (tx) =>
      setItemQuantity(tx, s.store, first.id, { itemId: first.items[0].id, quantity: 2 }, after),
    );
    expect(view.items[0].quantity).toBe(2);
    expect(await codeOf(scan(s, after))).toBe("product_expired");
  });
});
