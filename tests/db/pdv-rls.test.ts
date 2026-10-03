import { beforeEach, describe, expect, it } from "vitest";
import { withOrg } from "@/db/tenant";
import { makeOrg, resetDb, seedPayment, seedSale, seedSellable, seedStore } from "../helpers";

beforeEach(resetDb);

describe("phase 2 schema", () => {
  it("isolates terminals, sales and payments per tenant", async () => {
    const a = await makeOrg("A");
    const b = await makeOrg("B");
    const sa = await seedSale(a);
    const sb = await seedSale(b);
    await seedPayment(a, sa.saleId);
    await seedPayment(b, sb.saleId);
    const seen = await withOrg(a, async (tx) => ({
      terminals: await tx`select id from terminals`,
      sales: await tx`select id from sales`,
      payments: await tx`select id from payments`,
    }));
    expect([seen.terminals.length, seen.sales.length, seen.payments.length]).toEqual([1, 1, 1]);
  });

  it("blocks a sale that points at another tenant's terminal", async () => {
    const a = await makeOrg("A");
    const b = await makeOrg("B");
    const mine = await seedStore(a);
    const theirs = await seedStore(b);
    await expect(
      withOrg(a, (tx) => tx`
        insert into sales (org_id, market_id, terminal_id, expires_at)
        values (${a}, ${mine.marketId}, ${theirs.terminalId}, now())`),
    ).rejects.toThrow(/foreign key/);
  });

  it("blocks a sale item that points at another tenant's market product", async () => {
    const a = await makeOrg("A");
    const b = await makeOrg("B");
    const sale = await seedSale(a);
    const theirs = await seedStore(b);
    const sellable = await seedSellable(b, theirs.marketId);
    await expect(
      withOrg(a, (tx) => tx`
        insert into sale_items (org_id, sale_id, market_product_id, product_name, quantity, unit_price_cents)
        values (${a}, ${sale.saleId}, ${sellable.marketProductId}, 'x', 1, 100)`),
    ).rejects.toThrow(/foreign key/);
  });

  it("rejects the same provider charge twice, even across tenants", async () => {
    const a = await makeOrg("A");
    const b = await makeOrg("B");
    const sa = await seedSale(a);
    const sb = await seedSale(b);
    await seedPayment(a, sa.saleId, { externalId: "ext-1" });
    await expect(seedPayment(b, sb.saleId, { externalId: "ext-1" })).rejects.toThrow(/duplicate key/);
  });

  it("allows only one pending payment per sale", async () => {
    const a = await makeOrg("A");
    const { saleId } = await seedSale(a);
    await seedPayment(a, saleId, { status: "expired" });
    await seedPayment(a, saleId, { status: "pending" });
    await expect(seedPayment(a, saleId, { status: "pending" })).rejects.toThrow(/duplicate key/);
  });

  it("blocks a second sale movement for the same sale and product", async () => {
    const a = await makeOrg("A");
    const { saleId, marketId } = await seedSale(a);
    const { marketProductId } = await seedSellable(a, marketId);
    const sale = () =>
      withOrg(a, (tx) => tx`
        insert into stock_movements (org_id, market_product_id, type, quantity, sale_id)
        values (${a}, ${marketProductId}, 'sale', -1, ${saleId})`);
    await sale();
    await expect(sale()).rejects.toThrow(/duplicate key/);
    const manual = () =>
      withOrg(a, (tx) => tx`
        insert into stock_movements (org_id, market_product_id, type, quantity)
        values (${a}, ${marketProductId}, 'sale', -1)`);
    await manual();
    await expect(manual()).resolves.toBeDefined();
  });

  it("caps the sale total at R$ 10.000,00", async () => {
    const a = await makeOrg("A");
    const { saleId } = await seedSale(a);
    await expect(
      withOrg(a, (tx) => tx`update sales set total_cents = 1000001 where id = ${saleId}`),
    ).rejects.toThrow(/check constraint/);
    await expect(
      withOrg(a, (tx) => tx`update sales set total_cents = 1000000 where id = ${saleId}`),
    ).resolves.toBeDefined();
  });

  it("does not let the app role delete sales or terminals", async () => {
    const a = await makeOrg("A");
    await seedSale(a);
    await expect(withOrg(a, (tx) => tx`delete from sales`)).rejects.toThrow(/permission denied/);
    await expect(withOrg(a, (tx) => tx`delete from terminals`)).rejects.toThrow(/permission denied/);
  });
});
