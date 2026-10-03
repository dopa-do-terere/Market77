import { beforeEach, describe, expect, it } from "vitest";
import { withOrg } from "@/db/tenant";
import { getSaleDetail, listRecentSales } from "@/domain/sale-queries";
import { makeOrg, resetDb, seedPayment, seedSale } from "../helpers";

beforeEach(resetDb);

async function one(opts: Parameters<typeof seedPayment>[2]) {
  const orgId = await makeOrg("A");
  const { saleId } = await seedSale(orgId);
  await seedPayment(orgId, saleId, opts);
  return { orgId, saleId };
}

describe("sales for the owner panel", () => {
  it("does not flag a card payment that was declined for attention", async () => {
    const { orgId } = await one({ method: "card", status: "failed", failureReason: "declined" });
    const [row] = await withOrg(orgId, (tx) => listRecentSales(tx));
    expect(row.needsAttention).toBe(false);
  });

  it("flags a payment that the confirmation rejected (failed without a reason)", async () => {
    const { orgId } = await one({ method: "card", status: "failed" });
    const [row] = await withOrg(orgId, (tx) => listRecentSales(tx));
    expect(row.needsAttention).toBe(true);
  });

  it("returns the method and the failure reason in the detail", async () => {
    const { orgId, saleId } = await one({ method: "card", status: "failed", failureReason: "declined" });
    const detail = await withOrg(orgId, (tx) => getSaleDetail(tx, saleId));
    expect(detail?.payments[0]).toMatchObject({ method: "card", status: "failed", failureReason: "declined" });
  });
});
