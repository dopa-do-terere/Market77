import { beforeEach, describe, expect, it } from "vitest";
import { adminSql } from "@/db/client";
import { withOrg } from "@/db/tenant";
import { listExpiryAlerts } from "@/domain/lots";
import { addLot, makeOrg, resetDb, seedMarketProduct, track } from "../helpers";

beforeEach(resetDb);

const NOW = new Date("2026-10-03T15:00:00Z"); // today 2026-10-03, window ends 2026-10-10

describe("expiry alerts", () => {
  it("lists expired and expiring lots with stock, in date order, and nothing else", async () => {
    const orgId = await makeOrg("A");
    const { marketId, marketProductId: mp } = await seedMarketProduct(orgId);
    await track(mp);
    await addLot(orgId, mp, "2026-10-01", 3); // expired
    await addLot(orgId, mp, "2026-10-08", 4); // expiring
    await addLot(orgId, mp, "2026-10-10", 1); // last day of the window
    await addLot(orgId, mp, "2026-10-11", 9); // outside the window
    const empty = await addLot(orgId, mp, "2026-10-05", 2);
    await adminSql`insert into stock_movements (org_id, market_product_id, type, quantity, lot_id)
      values (${orgId}, ${mp}, 'loss', -2, ${empty})`; // sold out: no alert
    const alerts = await withOrg(orgId, (tx) => listExpiryAlerts(tx, marketId, NOW));
    expect(alerts.map((a) => [a.expiresOn, a.quantity, a.status])).toEqual([
      ["2026-10-01", 3, "expired"],
      ["2026-10-08", 4, "expiring"],
      ["2026-10-10", 1, "expiring"],
    ]);
    expect(alerts[0].productName).toBe("Água");
  });

  it("ignores products that do not track expiry and other markets", async () => {
    const orgId = await makeOrg("A");
    const untracked = await seedMarketProduct(orgId);
    await addLot(orgId, untracked.marketProductId, "2026-10-01", 3);
    const other = await seedMarketProduct(orgId);
    await track(other.marketProductId);
    await addLot(orgId, other.marketProductId, "2026-10-01", 3);
    expect(await withOrg(orgId, (tx) => listExpiryAlerts(tx, untracked.marketId, NOW))).toEqual([]);
    expect(await withOrg(orgId, (tx) => listExpiryAlerts(tx, other.marketId, NOW))).toHaveLength(1);
  });
});
