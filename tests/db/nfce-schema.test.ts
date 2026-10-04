import { beforeEach, describe, expect, it } from "vitest";
import { adminSql } from "@/db/client";
import { withOrg } from "@/db/tenant";
import { makeOrg, resetDb, seedProductless, seedSale } from "../helpers";

beforeEach(resetDb);

const doc = (orgId: string, saleId: string, marketId: string) =>
  adminSql`
    insert into fiscal_documents (org_id, sale_id, market_id, payload)
    values (${orgId}, ${saleId}, ${marketId}, '{}'::jsonb)
    returning id`;

describe("phase 5B schema", () => {
  it("has safe defaults for the new market and product columns", async () => {
    const orgId = await makeOrg("A");
    const { marketId, productId } = await seedProductless(orgId);
    const [m] = await adminSql`select nfce_enabled, tax_regime, nfce_series, uf from markets where id = ${marketId}`;
    expect([m.nfce_enabled, m.tax_regime, m.nfce_series, m.uf]).toEqual([false, "simples", 1, null]);
    const [p] = await adminSql`select ncm, cest, cfop, csosn, unit, origin from products where id = ${productId}`;
    expect([p.ncm, p.cest, p.cfop, p.csosn, p.unit, p.origin]).toEqual([null, null, "5102", "102", "UN", 0]);
  });

  it("refuses malformed fiscal values", async () => {
    const orgId = await makeOrg("A");
    const { marketId, productId } = await seedProductless(orgId);
    const bad = (q: Promise<unknown>) => expect(q).rejects.toThrow(/check/);
    await bad(adminSql`update markets set uf = 'sp' where id = ${marketId}`);
    await bad(adminSql`update markets set tax_regime = 'mei' where id = ${marketId}`);
    await bad(adminSql`update markets set nfce_series = 0 where id = ${marketId}`);
    await bad(adminSql`update products set ncm = '2202100' where id = ${productId}`);
    await bad(adminSql`update products set cest = '12345' where id = ${productId}`);
    await bad(adminSql`update products set origin = 9 where id = ${productId}`);
    await bad(adminSql`update products set unit = '' where id = ${productId}`);
  });

  it("accepts an 11-digit customer CPF on a sale and refuses anything else", async () => {
    const orgId = await makeOrg("A");
    const { saleId } = await seedSale(orgId);
    await adminSql`update sales set customer_cpf = '52998224725' where id = ${saleId}`;
    await expect(adminSql`update sales set customer_cpf = '5299822472' where id = ${saleId}`).rejects.toThrow(/check/);
    await expect(adminSql`update sales set customer_cpf = '529.982.247-25' where id = ${saleId}`).rejects.toThrow(/check/);
  });

  it("keeps one fiscal document per sale and a known status", async () => {
    const orgId = await makeOrg("A");
    const { saleId, marketId } = await seedSale(orgId);
    await doc(orgId, saleId, marketId);
    await expect(doc(orgId, saleId, marketId)).rejects.toThrow(/duplicate key/);
    await expect(adminSql`update fiscal_documents set status = 'done'`).rejects.toThrow(/check/);
  });

  it("isolates documents per tenant and lets the app role update but never delete them", async () => {
    const a = await makeOrg("A");
    const b = await makeOrg("B");
    const { saleId, marketId } = await seedSale(a);
    await doc(a, saleId, marketId);
    expect(await withOrg(b, (tx) => tx`select id from fiscal_documents`)).toEqual([]);
    expect(await withOrg(a, (tx) => tx`select id from fiscal_documents`)).toHaveLength(1);
    await withOrg(a, (tx) => tx`update fiscal_documents set attempts = 1`);
    await expect(withOrg(a, (tx) => tx`delete from fiscal_documents`)).rejects.toThrow(/permission denied/);
  });
});
