import { beforeEach, describe, expect, it } from "vitest";
import { withOrg } from "@/db/tenant";
import { processFiscalQueue } from "@/domain/fiscal";
import { countFiscalErrors, getSaleDetail, listRecentSales } from "@/domain/sale-queries";
import { resetFakeFiscal } from "@/fiscal/fake-fiscal";
import { fiscalShop, makeOrg, paidSale, resetDb } from "../helpers";

beforeEach(async () => {
  await resetDb();
  resetFakeFiscal();
});

const NOW = new Date("2026-10-03T15:00:00Z");

describe("fiscal reads", () => {
  it("shows no fiscal data for a market without NFC-e, and the CPF masked", async () => {
    const orgId = await makeOrg("A");
    const shop = await fiscalShop(orgId, { enabled: false });
    const saleId = await paidSale(orgId, shop, shop.barcode, 1, { cpf: "52998224725" });
    const d = await withOrg(orgId, (tx) => getSaleDetail(tx, saleId));
    expect(d?.fiscal).toBeNull();
    expect(d?.customerCpfMasked).toBe("***.982.247-**");
    expect(JSON.stringify(d)).not.toContain("52998224725");
  });

  it("follows the document from pending to issued", async () => {
    const orgId = await makeOrg("A");
    const shop = await fiscalShop(orgId);
    const saleId = await paidSale(orgId, shop, shop.barcode, 1);
    const pending = await withOrg(orgId, (tx) => getSaleDetail(tx, saleId));
    expect(pending?.fiscal).toMatchObject({ status: "pending", attempts: 0, number: null, lastError: null });
    await processFiscalQueue(NOW);
    const issued = await withOrg(orgId, (tx) => getSaleDetail(tx, saleId));
    expect(issued?.fiscal).toMatchObject({ status: "issued", attempts: 1, number: 1 });
    expect(issued?.fiscal?.accessKey).toMatch(/^\d{44}$/);
    expect(issued?.fiscal?.danfeUrl).toMatch(/^https?:\/\//);
  });

  it("flags sales and counts documents that ended in error", async () => {
    const orgId = await makeOrg("A");
    const bad = await fiscalShop(orgId, { ncm: null });
    const badSale = await paidSale(orgId, bad, bad.barcode, 1);
    await processFiscalQueue(NOW);
    expect(await withOrg(orgId, (tx) => countFiscalErrors(tx))).toBe(1);
    const list = await withOrg(orgId, (tx) => listRecentSales(tx));
    expect(list.find((s) => s.id === badSale)?.fiscalError).toBe(true);
    const detail = await withOrg(orgId, (tx) => getSaleDetail(tx, badSale));
    expect(detail?.fiscal).toMatchObject({ status: "error" });
    expect(detail?.fiscal?.lastError).toMatch(/missing_ncm/);
  });

  it("counts only the tenant's own errors", async () => {
    const a = await makeOrg("A");
    const b = await makeOrg("B");
    const shop = await fiscalShop(b, { ncm: null });
    await paidSale(b, shop, shop.barcode, 1);
    await processFiscalQueue(NOW);
    expect(await withOrg(a, (tx) => countFiscalErrors(tx))).toBe(0);
    expect(await withOrg(b, (tx) => countFiscalErrors(tx))).toBe(1);
  });
});
