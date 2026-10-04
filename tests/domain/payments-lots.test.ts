import { beforeEach, describe, expect, it } from "vitest";
import { adminSql } from "@/db/client";
import { withOrg } from "@/db/tenant";
import { listLotBalances } from "@/domain/lots";
import { confirmPayment, startPayment } from "@/domain/payments";
import { addItemByBarcode } from "@/domain/sales";
import { getBalance } from "@/domain/stock";
import { fakeProvider } from "@/payments/fake";
import { addLot, makeOrg, resetDb, seedSellable, seedStore, track } from "../helpers";

beforeEach(resetDb);

const NOW = new Date("2026-10-03T15:00:00Z");
const BARCODE = "7891000100103";

async function shop(tracked = true) {
  const orgId = await makeOrg("A");
  const store = await seedStore(orgId);
  const item = await seedSellable(orgId, store.marketId, { barcode: BARCODE, priceCents: 500 });
  if (tracked) await track(item.marketProductId);
  return { orgId, store, mp: item.marketProductId };
}
type Shop = Awaited<ReturnType<typeof shop>>;

/** An open sale with `units` of the product, payment started. Returns the payment id and total. */
async function checkout(s: Shop, units: number) {
  let sale = await withOrg(s.orgId, (tx) => addItemByBarcode(tx, s.orgId, s.store, { barcode: BARCODE }, NOW));
  for (let i = 1; i < units; i++) {
    sale = await withOrg(s.orgId, (tx) =>
      addItemByBarcode(tx, s.orgId, s.store, { saleId: sale.id, barcode: BARCODE }, NOW),
    );
  }
  await withOrg(s.orgId, (tx) => startPayment(tx, s.orgId, s.store, sale.id, fakeProvider, NOW));
  const [p] = await adminSql`select id from payments where sale_id = ${sale.id}`;
  return { saleId: sale.id as string, paymentId: p.id as string, total: units * 500 };
}
const confirm = (s: Shop, c: { paymentId: string; total: number }, now = NOW) =>
  withOrg(s.orgId, (tx) => confirmPayment(tx, c.paymentId, c.total, { test: true }, now));
const sold = (saleId: string) =>
  adminSql`select quantity, lot_id from stock_movements where sale_id = ${saleId} order by quantity, id`;
const lots = (s: Shop) => withOrg(s.orgId, (tx) => listLotBalances(tx, s.mp));

describe("selling a tracked product", () => {
  it("takes one unit from each lot when the sale spans two lots", async () => {
    const s = await shop();
    await addLot(s.orgId, s.mp, "2026-10-10", 1);
    await addLot(s.orgId, s.mp, "2026-10-20", 5);
    const c = await checkout(s, 2);
    expect(await confirm(s, c)).toBe("confirmed");
    expect((await lots(s)).map((l) => l.balance)).toEqual([0, 4]);
    expect(await sold(c.saleId)).toHaveLength(2);
  });

  it("does not take stock twice when the same payment is confirmed again", async () => {
    const s = await shop();
    await addLot(s.orgId, s.mp, "2026-10-10", 1);
    await addLot(s.orgId, s.mp, "2026-10-20", 5);
    const c = await checkout(s, 2);
    await confirm(s, c);
    expect(await confirm(s, c)).toBe("already_confirmed");
    expect(await sold(c.saleId)).toHaveLength(2);
    expect(await withOrg(s.orgId, (tx) => getBalance(tx, s.mp))).toBe(4);
  });

  it("sells an expired lot first, because the oldest item leaves first", async () => {
    const s = await shop();
    await addLot(s.orgId, s.mp, "2026-10-01", 1); // expired by NOW
    await addLot(s.orgId, s.mp, "2026-10-20", 5);
    const c = await checkout(s, 1);
    await confirm(s, c);
    expect((await lots(s)).map((l) => l.balance)).toEqual([0, 5]);
  });

  it("books the shortfall without a lot and leaves the balance negative", async () => {
    const s = await shop();
    await addLot(s.orgId, s.mp, "2026-10-10", 1);
    const c = await checkout(s, 2);
    await confirm(s, c);
    const parts = await sold(c.saleId);
    expect(parts.map((r) => r.quantity)).toEqual([-1, -1]);
    expect(parts.map((r) => r.lot_id === null).sort()).toEqual([false, true]);
    expect(await withOrg(s.orgId, (tx) => getBalance(tx, s.mp))).toBe(-1);
  });

  it("does not let two concurrent confirmations read the same lot balance", async () => {
    const s = await shop();
    await addLot(s.orgId, s.mp, "2026-10-10", 1);
    await addLot(s.orgId, s.mp, "2026-10-20", 5);
    const one = await checkout(s, 1);
    const two = await checkout(s, 1);
    await Promise.all([confirm(s, one), confirm(s, two)]);
    expect((await lots(s)).map((l) => l.balance)).toEqual([0, 4]);
  });

  it("still confirms after the lots expired", async () => {
    const s = await shop();
    await addLot(s.orgId, s.mp, "2026-10-04", 1);
    const c = await checkout(s, 1);
    const later = new Date("2026-10-20T12:00:00Z");
    expect(await confirm(s, c, later)).toBe("confirmed");
  });
});

describe("selling a product without expiry control", () => {
  it("books a single movement with no lot, as before", async () => {
    const s = await shop(false);
    await adminSql`insert into stock_movements (org_id, market_product_id, type, quantity)
      values (${s.orgId}, ${s.mp}, 'in', 5)`;
    const c = await checkout(s, 2);
    await confirm(s, c);
    expect((await sold(c.saleId)).map((r) => [r.quantity, r.lot_id])).toEqual([[-2, null]]);
  });
});
