import { beforeEach, describe, expect, it } from "vitest";
import { adminSql } from "@/db/client";
import { withOrg } from "@/db/tenant";
import { getSaleView } from "@/domain/sales";
import { makeOrg, resetDb, seedPayment, seedSale } from "../helpers";

beforeEach(resetDb);

async function open() {
  const orgId = await makeOrg("A");
  const s = await seedSale(orgId);
  const view = () => withOrg(orgId, (tx) => getSaleView(tx, s.saleId));
  return { orgId, ...s, view };
}

describe("getSaleView payment fields", () => {
  it("shows the method and no QR for a pending card payment, and no failure", async () => {
    const r = await open();
    await seedPayment(r.orgId, r.saleId, { method: "card" });
    const v = await r.view();
    expect(v.payment).toMatchObject({ method: "card", qrPayload: null, failureReason: null, status: "pending" });
    expect(v.paymentFailure).toBeNull();
  });

  it("reports the failure of the last payment of an open sale", async () => {
    const r = await open();
    await seedPayment(r.orgId, r.saleId, { method: "card", status: "failed", failureReason: "declined" });
    expect((await r.view()).paymentFailure).toEqual({ method: "card", reason: "declined" });
  });

  it("reports an expired or cancelled payment the same way, for Pix too", async () => {
    const r = await open();
    await seedPayment(r.orgId, r.saleId, { method: "pix", status: "expired", failureReason: "cancelled" });
    expect((await r.view()).paymentFailure).toEqual({ method: "pix", reason: "cancelled" });
  });

  it("does not report a failure without a reason, such as a payment the confirmation rejected", async () => {
    const r = await open();
    await seedPayment(r.orgId, r.saleId, { method: "card", status: "failed" });
    expect((await r.view()).paymentFailure).toBeNull();
  });

  it("does not report a failure once a new payment is pending or the sale is not open", async () => {
    const r = await open();
    await seedPayment(r.orgId, r.saleId, { method: "card", status: "failed", failureReason: "declined" });
    await seedPayment(r.orgId, r.saleId, { method: "pix" });
    expect((await r.view()).paymentFailure).toBeNull();
    await adminSql`update sales set status = 'awaiting_payment' where id = ${r.saleId}`;
    expect((await r.view()).paymentFailure).toBeNull();
  });
});
