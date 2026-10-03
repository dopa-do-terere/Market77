import { beforeEach, describe, expect, it } from "vitest";
import { adminSql } from "@/db/client";
import { withOrg } from "@/db/tenant";
import { setMarketProduct } from "@/domain/market-products";
import { addItemByBarcode, cancelSale, getSaleView, setItemQuantity } from "@/domain/sales";
import { codeOf, makeOrg, resetDb, seedSellable, seedStore } from "../helpers";

beforeEach(resetDb);

const NOW = new Date("2026-10-02T12:00:00Z");
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);
const BARCODE = "7891000100103";

async function setup(priceCents = 500) {
  const orgId = await makeOrg("A");
  const store = await seedStore(orgId);
  const item = await seedSellable(orgId, store.marketId, { barcode: BARCODE, priceCents });
  const scan = (barcode = BARCODE, saleId?: string, now = NOW) =>
    withOrg(orgId, (tx) => addItemByBarcode(tx, orgId, store, { saleId, barcode }, now));
  return { orgId, store, item, scan };
}

const salesCount = async () => (await adminSql`select count(*)::int as n from sales`)[0].n as number;

describe("cart", () => {
  it("creates the sale on the first scan and counts repeated scans", async () => {
    const { scan } = await setup();
    const first = await scan();
    expect([first.status, first.totalCents, first.items.map((i) => i.quantity)]).toEqual(["open", 500, [1]]);
    const second = await scan(BARCODE, first.id);
    expect([second.id, second.totalCents, second.items[0].quantity]).toEqual([first.id, 1000, 2]);
    expect(second.expiresAt).toEqual(minutes(5));
  });

  it("rejects an unknown barcode without leaving an empty sale behind", async () => {
    const { scan } = await setup();
    expect(await codeOf(scan("0000"))).toBe("product_not_found");
    expect(await salesCount()).toBe(0);
  });

  it("rejects an empty saleId as invalid_input", async () => {
    const { scan } = await setup();
    expect(await codeOf(scan(BARCODE, ""))).toBe("invalid_input");
    expect(await salesCount()).toBe(0);
  });

  it("rejects an inactive product", async () => {
    const { orgId, store, scan } = await setup();
    await seedSellable(orgId, store.marketId, { barcode: "INATIVO-1", active: false });
    expect(await codeOf(scan("INATIVO-1"))).toBe("product_inactive");
  });

  it("does not sell a product that only exists in another market", async () => {
    const { orgId, scan } = await setup();
    const other = await seedStore(orgId);
    await seedSellable(orgId, other.marketId, { barcode: "OUTRO-1" });
    expect(await codeOf(scan("OUTRO-1"))).toBe("product_not_found");
  });

  it("freezes the unit price at the first scan", async () => {
    const { orgId, store, item, scan } = await setup();
    const first = await scan();
    await withOrg(orgId, (tx) =>
      setMarketProduct(tx, orgId, { marketId: store.marketId, productId: item.productId, priceCents: 900 }),
    );
    const second = await scan(BARCODE, first.id);
    expect([second.items[0].unitPriceCents, second.totalCents]).toEqual([500, 1000]);
    expect((await scan()).totalCents).toBe(900);
  });

  it("renews the inactivity window on each change and expires an abandoned cart", async () => {
    const { scan } = await setup();
    const first = await scan();
    expect((await scan(BARCODE, first.id, minutes(4))).expiresAt).toEqual(minutes(9));
    expect(await codeOf(scan(BARCODE, first.id, minutes(10)))).toBe("sale_not_editable");
  });

  it("changes quantities, removes with zero and rejects out-of-range values", async () => {
    const { orgId, store, scan } = await setup();
    const first = await scan();
    const itemId = first.items[0].id;
    const set = (quantity: number) =>
      withOrg(orgId, (tx) => setItemQuantity(tx, store, first.id, { itemId, quantity }, NOW));
    expect((await set(3)).totalCents).toBe(1500);
    for (const bad of [100, -1, 1.5]) expect(await codeOf(set(bad))).toBe("invalid_input");
    expect((await set(0)).items).toHaveLength(0);
    expect(await codeOf(set(1))).toBe("not_found");
    expect(await codeOf(withOrg(orgId, (tx) => setItemQuantity(tx, store, first.id, { itemId: "x", quantity: 1 }, NOW)))).toBe("not_found");
  });

  it("stops at 99 units of one product", async () => {
    const { orgId, store, scan } = await setup();
    const first = await scan();
    await withOrg(orgId, (tx) =>
      setItemQuantity(tx, store, first.id, { itemId: first.items[0].id, quantity: 99 }, NOW),
    );
    expect(await codeOf(scan(BARCODE, first.id))).toBe("quantity_limit");
  });

  it("refuses a total above R$ 10.000,00 and keeps the previous total", async () => {
    const { orgId, store, scan } = await setup(600000);
    await seedSellable(orgId, store.marketId, { barcode: "CARO-2", priceCents: 600000 });
    const first = await scan();
    expect(await codeOf(scan("CARO-2", first.id))).toBe("sale_too_large");
    expect((await withOrg(orgId, (tx) => getSaleView(tx, first.id))).totalCents).toBe(600000);
  });

  it("refuses a single product above the cap and creates no sale", async () => {
    const { scan } = await setup(1000001);
    expect(await codeOf(scan())).toBe("sale_too_large");
    expect(await salesCount()).toBe(0);
  });

  it("counts exactly when ten scans race on the same sale", async () => {
    const { scan } = await setup();
    const first = await scan();
    await Promise.all(Array.from({ length: 10 }, () => scan(BARCODE, first.id)));
    const view = await scan(BARCODE, first.id);
    expect([view.items[0].quantity, view.totalCents]).toEqual([12, 6000]);
  });
});

describe("sale access", () => {
  it("hides another terminal's sale, another tenant's sale and malformed ids", async () => {
    const { orgId, store, scan } = await setup();
    const first = await scan();
    const otherTerminal = { ...(await seedStore(orgId)) };
    const cancel = (o: string, t: { terminalId: string; marketId: string }, id: string) =>
      withOrg(o, (tx) => cancelSale(tx, t, id, NOW));
    expect(await codeOf(cancel(orgId, otherTerminal, first.id))).toBe("sale_not_found");
    expect(await codeOf(cancel(orgId, store, "nope"))).toBe("sale_not_found");
    const b = await makeOrg("B");
    const theirs = await seedStore(b);
    expect(await codeOf(cancel(b, theirs, first.id))).toBe("sale_not_found");
  });

  it("cancels an open sale once and never after", async () => {
    const { orgId, store, scan } = await setup();
    const first = await scan();
    const cancelled = await withOrg(orgId, (tx) => cancelSale(tx, store, first.id, NOW));
    expect(cancelled.status).toBe("cancelled");
    expect(await codeOf(withOrg(orgId, (tx) => cancelSale(tx, store, first.id, NOW)))).toBe("sale_not_editable");
    expect(await codeOf(scan(BARCODE, first.id))).toBe("sale_not_editable");
  });
});
