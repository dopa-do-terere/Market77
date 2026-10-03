import { beforeEach, describe, expect, it } from "vitest";
import { adminSql } from "@/db/client";
import { makeOrg, resetDb, seedPayment, seedSale } from "../helpers";

beforeEach(resetDb);

describe("phase 4 schema", () => {
  it("accepts a card payment without a QR payload", async () => {
    const orgId = await makeOrg("A");
    const { saleId } = await seedSale(orgId);
    const id = await seedPayment(orgId, saleId, { method: "card" });
    const [row] = await adminSql`select method, qr_payload from payments where id = ${id}`;
    expect([row.method, row.qr_payload]).toEqual(["card", null]);
  });

  it("still requires a QR payload for Pix and refuses unknown methods", async () => {
    const orgId = await makeOrg("A");
    const { saleId } = await seedSale(orgId);
    const raw = (method: string, qr: string | null) =>
      adminSql`
        insert into payments (org_id, sale_id, method, provider, external_id, amount_cents, qr_payload, expires_at)
        values (${orgId}, ${saleId}, ${method}, 'fake', ${`x-${method}-${qr}`}, 100, ${qr}, now())`;
    await expect(raw("pix", null)).rejects.toThrow(/check/);
    await expect(raw("boleto", "qr")).rejects.toThrow(/check/);
  });

  it("only accepts the known failure reasons", async () => {
    const orgId = await makeOrg("A");
    const { saleId } = await seedSale(orgId);
    for (const reason of ["declined", "cancelled", "expired"]) {
      await seedPayment(orgId, saleId, { method: "card", status: "failed", failureReason: reason });
    }
    await expect(
      seedPayment(orgId, saleId, { method: "card", status: "failed", failureReason: "oops" }),
    ).rejects.toThrow(/check/);
  });

  it("keeps one pending payment per sale across methods", async () => {
    const orgId = await makeOrg("A");
    const { saleId } = await seedSale(orgId);
    await seedPayment(orgId, saleId, { method: "pix" });
    await expect(seedPayment(orgId, saleId, { method: "card" })).rejects.toThrow(/unique|duplicate/);
  });
});
