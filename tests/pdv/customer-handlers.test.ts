import { beforeEach, describe, expect, it } from "vitest";
import { adminSql } from "@/db/client";
import { withOrg } from "@/db/tenant";
import { createTerminal } from "@/domain/terminals";
import { customerHandler, getSaleHandler, payHandler, scanHandler } from "@/pdv/http";
import { makeOrg, resetDb, seedSellable, seedStore } from "../helpers";

beforeEach(resetDb);

const BARCODE = "7891000100103";

const call = (token: string | undefined, body?: unknown, raw?: string) =>
  new Request("http://m77.test/api/pdv/x", {
    method: "POST",
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
const json = async (res: Response) => (await res.json()) as Record<string, any>;

async function setup() {
  const orgId = await makeOrg("A");
  const store = await seedStore(orgId);
  await seedSellable(orgId, store.marketId, { barcode: BARCODE, priceCents: 500 });
  const { token } = await withOrg(orgId, (tx) => createTerminal(tx, orgId, { marketId: store.marketId, name: "Totem 1" }));
  const other = await withOrg(orgId, (tx) => createTerminal(tx, orgId, { marketId: store.marketId, name: "Totem 2" }));
  const sale = await json(await scanHandler(call(token, { barcode: BARCODE })));
  const stored = async () =>
    (await adminSql`select customer_cpf from sales where id = ${sale.id}`)[0].customer_cpf as string | null;
  return { token, otherToken: other.token, saleId: sale.id as string, stored };
}

describe("PUT customer", () => {
  it("stores the CPF as digits and returns it masked", async () => {
    const s = await setup();
    const res = await customerHandler(call(s.token, { cpf: "529.982.247-25" }), s.saleId);
    const view = await json(res);
    expect([res.status, view.customerCpfMasked]).toEqual([200, "***.982.247-**"]);
    expect(JSON.stringify(view)).not.toContain("52998224725");
    expect(await s.stored()).toBe("52998224725");
    const again = await json(await getSaleHandler(call(s.token), s.saleId));
    expect(again.customerCpfMasked).toBe("***.982.247-**");
  });

  it("clears the CPF with null and starts without one", async () => {
    const s = await setup();
    expect((await json(await getSaleHandler(call(s.token), s.saleId))).customerCpfMasked).toBeNull();
    await customerHandler(call(s.token, { cpf: "52998224725" }), s.saleId);
    const res = await customerHandler(call(s.token, { cpf: null }), s.saleId);
    expect([res.status, (await json(res)).customerCpfMasked]).toEqual([200, null]);
    expect(await s.stored()).toBeNull();
  });

  it("answers 400 to a bad CPF, a missing field and broken JSON, and keeps the old value", async () => {
    const s = await setup();
    await customerHandler(call(s.token, { cpf: "52998224725" }), s.saleId);
    const bad = await customerHandler(call(s.token, { cpf: "52998224724" }), s.saleId);
    expect([bad.status, (await json(bad)).error]).toEqual([400, "invalid_cpf"]);
    expect((await customerHandler(call(s.token, {}), s.saleId)).status).toBe(400);
    expect((await customerHandler(call(s.token, undefined, "{"), s.saleId)).status).toBe(400);
    expect((await customerHandler(call(s.token, { cpf: 123 }), s.saleId)).status).toBe(400);
    expect(await s.stored()).toBe("52998224725");
  });

  it("answers 401 without a valid token and 404 for another totem's or a malformed sale", async () => {
    const s = await setup();
    expect((await customerHandler(call(undefined, { cpf: null }), s.saleId)).status).toBe(401);
    expect((await customerHandler(call("bad", { cpf: null }), s.saleId)).status).toBe(401);
    expect((await customerHandler(call(s.otherToken, { cpf: null }), s.saleId)).status).toBe(404);
    expect((await customerHandler(call(s.token, { cpf: null }), "nope")).status).toBe(404);
  });

  it("answers 409 once the sale left the cart", async () => {
    const s = await setup();
    await payHandler(call(s.token, { method: "pix" }), s.saleId);
    const res = await customerHandler(call(s.token, { cpf: "52998224725" }), s.saleId);
    expect([res.status, (await json(res)).error]).toEqual([409, "sale_not_editable"]);
    expect(await s.stored()).toBeNull();
  });
});
