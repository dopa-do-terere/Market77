import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adminSql } from "@/db/client";
import { type Tx, withOrg } from "@/db/tenant";
import { enqueueFiscalDocument } from "@/domain/fiscal";
import { fiscalShop, makeOrg, paidSale, resetDb } from "../helpers";

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());

const NOW = new Date("2026-10-03T15:00:00Z");
const docs = (saleId: string) => adminSql`select * from fiscal_documents where sale_id = ${saleId}`;

describe("enqueue on payment", () => {
  it("queues a pending document with a frozen snapshot of the sale", async () => {
    const orgId = await makeOrg("A");
    const shop = await fiscalShop(orgId);
    const saleId = await paidSale(orgId, shop, shop.barcode, 2);
    const [d] = await docs(saleId);
    expect(d.status).toBe("pending");
    expect(d.attempts).toBe(0);
    expect(d.next_attempt_at).toEqual(NOW);
    expect(d.payload).toEqual({
      emitter: { cnpj: "12345678000195", stateRegistration: "123456789", uf: "SP", series: 1, regime: "simples" },
      customer: null,
      items: [
        {
          description: "Água",
          ncm: "22021000",
          cest: null,
          cfop: "5102",
          csosn: "102",
          unit: "UN",
          origin: 0,
          quantity: 2,
          unitPriceCents: 500,
          totalCents: 1000,
        },
      ],
      totalCents: 1000,
      paymentMethod: "pix",
      paidAt: NOW.toISOString(),
    });
    await adminSql`update products set ncm = '99999999' where id = ${shop.productId}`;
    const [after] = await docs(saleId);
    expect((after.payload as { items: { ncm: string }[] }).items[0].ncm).toBe("22021000");
  });

  it("carries the customer CPF when the sale has one", async () => {
    const orgId = await makeOrg("A");
    const shop = await fiscalShop(orgId);
    const saleId = await paidSale(orgId, shop, shop.barcode, 1, { cpf: "52998224725" });
    expect(((await docs(saleId))[0].payload as { customer: unknown }).customer).toEqual({ cpf: "52998224725" });
  });

  it("creates nothing for a market with NFC-e off", async () => {
    const orgId = await makeOrg("A");
    const shop = await fiscalShop(orgId, { enabled: false });
    const saleId = await paidSale(orgId, shop, shop.barcode, 1);
    expect(await docs(saleId)).toHaveLength(0);
  });

  it("queues at most one document per sale", async () => {
    const orgId = await makeOrg("A");
    const shop = await fiscalShop(orgId);
    const saleId = await paidSale(orgId, shop, shop.barcode, 1);
    await withOrg(orgId, (tx) => enqueueFiscalDocument(tx, saleId, NOW));
    expect(await docs(saleId)).toHaveLength(1);
  });

  it("never breaks the surrounding transaction when queueing fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const orgId = await makeOrg("A");
    const shop = await fiscalShop(orgId);
    const saleId = await paidSale(orgId, shop, shop.barcode, 1);
    const bad = async (t: Tx): Promise<never> => {
      await t`select 1/0`;
      throw new Error("unreachable");
    };
    const rows = await withOrg(orgId, async (tx) => {
      await enqueueFiscalDocument(tx, saleId, NOW, bad);
      return tx`select 1 as one`;
    });
    expect(rows[0].one).toBe(1);
    expect(console.error).toHaveBeenCalled();
  });

  it("does not build anything when NFC-e is off", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const orgId = await makeOrg("A");
    const shop = await fiscalShop(orgId, { enabled: false });
    const saleId = await paidSale(orgId, shop, shop.barcode, 1);
    const boom = async (): Promise<never> => {
      throw new Error("build must not run");
    };
    await withOrg(orgId, (tx) => enqueueFiscalDocument(tx, saleId, NOW, boom));
    expect(spy).not.toHaveBeenCalled();
    expect(await docs(saleId)).toHaveLength(0);
  });
});
