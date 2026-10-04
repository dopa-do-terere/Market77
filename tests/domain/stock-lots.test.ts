import { beforeEach, describe, expect, it } from "vitest";
import { adminSql } from "@/db/client";
import { withOrg } from "@/db/tenant";
import { listLotBalances } from "@/domain/lots";
import { getBalance, recordMovement } from "@/domain/stock";
import { addLot, codeOf, makeOrg, resetDb, seedMarketProduct, track } from "../helpers";

beforeEach(resetDb);

const NOW = new Date("2026-10-03T15:00:00Z"); // 2026-10-03 in Sao Paulo

async function tracked() {
  const orgId = await makeOrg("A");
  const s = await seedMarketProduct(orgId);
  await track(s.marketProductId);
  return { orgId, mp: s.marketProductId };
}
const move = (orgId: string, mp: string, type: string, quantity: number, extra: object = {}) =>
  withOrg(orgId, (tx) => recordMovement(tx, orgId, null, { marketProductId: mp, type, quantity, ...extra }, NOW));
const lots = (orgId: string, mp: string) => withOrg(orgId, (tx) => listLotBalances(tx, mp));
const rows = (mp: string) =>
  adminSql`select type, quantity, lot_id from stock_movements where market_product_id = ${mp} order by quantity, id`;

describe("entries into a tracked product", () => {
  it("requires a real expiry that is today or later", async () => {
    const { orgId, mp } = await tracked();
    expect(await codeOf(move(orgId, mp, "in", 5))).toBe("invalid_input");
    expect(await codeOf(move(orgId, mp, "in", 5, { expiresOn: "2026-10-02" }))).toBe("invalid_input");
    expect(await codeOf(move(orgId, mp, "in", 5, { expiresOn: "2026-02-30" }))).toBe("invalid_input");
    expect(await codeOf(move(orgId, mp, "in", 5, { expiresOn: "amanha" }))).toBe("invalid_input");
    expect(await rows(mp)).toHaveLength(0);
    expect((await adminSql`select id from stock_lots`).length).toBe(0);
  });

  it("books into the lot of the date and sums a second entry into the same lot", async () => {
    const { orgId, mp } = await tracked();
    await move(orgId, mp, "in", 5, { expiresOn: "2026-10-03" }); // valid through today
    await move(orgId, mp, "in", 2, { expiresOn: "2026-10-03" });
    await move(orgId, mp, "in", 1, { expiresOn: "2026-11-01" });
    expect((await lots(orgId, mp)).map((l) => [l.expiresOn, l.balance])).toEqual([
      ["2026-10-03", 7],
      ["2026-11-01", 1],
    ]);
  });

  it("requires an expiry for a positive adjustment too", async () => {
    const { orgId, mp } = await tracked();
    expect(await codeOf(move(orgId, mp, "adjustment", 3))).toBe("invalid_input");
    await move(orgId, mp, "adjustment", 3, { expiresOn: "2026-12-01" });
    expect((await lots(orgId, mp))[0].balance).toBe(3);
  });
});

describe("removals from a tracked product", () => {
  it("takes from the earliest lots when no lot is given", async () => {
    const { orgId, mp } = await tracked();
    await addLot(orgId, mp, "2026-10-10", 2);
    await addLot(orgId, mp, "2026-10-20", 5);
    await move(orgId, mp, "loss", 4);
    expect((await lots(orgId, mp)).map((l) => l.balance)).toEqual([0, 3]);
    expect(await withOrg(orgId, (tx) => getBalance(tx, mp))).toBe(3);
  });

  it("books the shortfall without a lot and lets the balance go negative", async () => {
    const { orgId, mp } = await tracked();
    await addLot(orgId, mp, "2026-10-10", 2);
    await addLot(orgId, mp, "2026-10-20", 5);
    await move(orgId, mp, "loss", 10);
    const out = (await rows(mp)).filter((r) => r.quantity < 0);
    expect(out.map((r) => [r.quantity, r.lot_id === null])).toEqual([
      [-5, false],
      [-3, true],
      [-2, false],
    ]);
    expect(await withOrg(orgId, (tx) => getBalance(tx, mp))).toBe(-3);
  });

  it("takes from the chosen lot, and refuses a lot of another product or an unknown one", async () => {
    const { orgId, mp } = await tracked();
    const other = await seedMarketProduct(orgId);
    await track(other.marketProductId);
    const early = await addLot(orgId, mp, "2026-10-10", 4);
    const late = await addLot(orgId, mp, "2026-10-20", 4);
    const foreign = await addLot(orgId, other.marketProductId, "2026-10-10", 4);
    await move(orgId, mp, "loss", 3, { lotId: late });
    expect((await lots(orgId, mp)).map((l) => [l.id === early, l.balance])).toEqual([
      [true, 4],
      [false, 1],
    ]);
    expect(await codeOf(move(orgId, mp, "loss", 1, { lotId: foreign }))).toBe("not_found");
    expect(await codeOf(move(orgId, mp, "loss", 1, { lotId: "00000000-0000-4000-8000-000000000000" }))).toBe(
      "not_found",
    );
    expect(await codeOf(move(orgId, mp, "loss", 1, { lotId: "nope" }))).toBe("invalid_input");
  });

  it("uses FEFO for a negative adjustment", async () => {
    const { orgId, mp } = await tracked();
    await addLot(orgId, mp, "2026-10-10", 2);
    await addLot(orgId, mp, "2026-10-20", 5);
    await move(orgId, mp, "adjustment", -3);
    expect((await lots(orgId, mp)).map((l) => l.balance)).toEqual([0, 4]);
  });
});

describe("a product without expiry control", () => {
  it("ignores expiresOn and lotId and books no lot", async () => {
    const orgId = await makeOrg("A");
    const { marketProductId: mp } = await seedMarketProduct(orgId);
    await move(orgId, mp, "in", 5, { expiresOn: "2020-01-01" });
    await move(orgId, mp, "loss", 1, { lotId: "00000000-0000-4000-8000-000000000000" });
    expect((await rows(mp)).map((r) => [r.quantity, r.lot_id])).toEqual([
      [-1, null],
      [5, null],
    ]);
    expect((await adminSql`select id from stock_lots`).length).toBe(0);
  });

  it("rejects a lot of another organization and books nothing", async () => {
    const { orgId, mp } = await tracked();
    const b = await makeOrg("B");
    const other = await seedMarketProduct(b);
    await track(other.marketProductId);
    const foreignLot = await addLot(b, other.marketProductId, "2026-12-01", 5);
    expect(await codeOf(move(orgId, mp, "loss", 1, { lotId: foreignLot }))).toBe("not_found");
    expect(await rows(mp)).toHaveLength(0);
    expect(await rows(other.marketProductId)).toHaveLength(1);
  });

  it("keeps the old balance as the unlotted balance when control is turned on", async () => {
    const orgId = await makeOrg("A");
    const { marketProductId: mp } = await seedMarketProduct(orgId);
    await move(orgId, mp, "in", 6);
    await track(mp);
    await move(orgId, mp, "in", 2, { expiresOn: "2026-12-01" });
    expect(await withOrg(orgId, (tx) => getBalance(tx, mp))).toBe(8);
    await move(orgId, mp, "loss", 3); // lot first (2), then 1 from the unlotted bucket
    const out = (await rows(mp)).filter((r) => r.quantity < 0);
    expect(out.map((r) => [r.quantity, r.lot_id === null])).toEqual([
      [-2, false],
      [-1, true],
    ]);
  });
});
