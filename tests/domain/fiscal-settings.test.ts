import { beforeEach, describe, expect, it } from "vitest";
import { withOrg } from "@/db/tenant";
import { createMarket, listMarkets, updateMarketFiscal } from "@/domain/markets";
import { createProduct, listProducts, updateProductFiscal } from "@/domain/products";
import { codeOf, makeOrg, resetDb } from "../helpers";

beforeEach(resetDb);

const UNKNOWN = "00000000-0000-4000-8000-000000000000";

describe("market fiscal settings", () => {
  async function market(orgId: string) {
    return withOrg(orgId, (tx) => createMarket(tx, orgId, { name: "Loja" }));
  }
  const first = async (orgId: string) => (await withOrg(orgId, (tx) => listMarkets(tx)))[0];

  it("saves the fiscal data, formats the CNPJ to digits and keeps omitted fields", async () => {
    const orgId = await makeOrg("A");
    const m = await market(orgId);
    await withOrg(orgId, (tx) =>
      updateMarketFiscal(tx, m.id, {
        nfceEnabled: true,
        cnpj: "12.345.678/0001-95",
        stateRegistration: "123456789",
        uf: "SP",
        taxRegime: "simples",
        nfceSeries: 2,
      }),
    );
    expect(await first(orgId)).toMatchObject({
      nfceEnabled: true,
      cnpj: "12345678000195",
      stateRegistration: "123456789",
      uf: "SP",
      taxRegime: "simples",
      nfceSeries: 2,
    });
    await withOrg(orgId, (tx) => updateMarketFiscal(tx, m.id, { nfceEnabled: false, uf: "RJ" }));
    expect(await first(orgId)).toMatchObject({ nfceEnabled: false, cnpj: "12345678000195", uf: "RJ", nfceSeries: 2 });
  });

  it("accepts the normal regime in the registration (issuing refuses it later)", async () => {
    const orgId = await makeOrg("A");
    const m = await market(orgId);
    await withOrg(orgId, (tx) => updateMarketFiscal(tx, m.id, { nfceEnabled: true, taxRegime: "normal" }));
    expect((await first(orgId)).taxRegime).toBe("normal");
  });

  it("refuses bad values", async () => {
    const orgId = await makeOrg("A");
    const m = await market(orgId);
    const run = (raw: object) => codeOf(withOrg(orgId, (tx) => updateMarketFiscal(tx, m.id, { nfceEnabled: true, ...raw })));
    expect(await run({ cnpj: "12345678000190" })).toBe("invalid_input");
    expect(await run({ uf: "sp" })).toBe("invalid_input");
    expect(await run({ uf: "XX" })).toBe("invalid_input");
    expect(await run({ taxRegime: "mei" })).toBe("invalid_input");
    expect(await run({ nfceSeries: 0 })).toBe("invalid_input");
    expect(await run({ nfceSeries: 1000 })).toBe("invalid_input");
    expect(await codeOf(withOrg(orgId, (tx) => updateMarketFiscal(tx, m.id, {})))).toBe("invalid_input");
  });

  it("does not find unknown, malformed or other-tenant markets", async () => {
    const a = await makeOrg("A");
    const b = await makeOrg("B");
    const theirs = await market(b);
    const run = (id: string) => codeOf(withOrg(a, (tx) => updateMarketFiscal(tx, id, { nfceEnabled: true })));
    expect(await run(UNKNOWN)).toBe("not_found");
    expect(await run("nope")).toBe("not_found");
    expect(await run(theirs.id)).toBe("not_found");
  });

  it("requires check digits on the CNPJ when creating a market", async () => {
    const orgId = await makeOrg("A");
    expect(await codeOf(withOrg(orgId, (tx) => createMarket(tx, orgId, { name: "Loja", cnpj: "12345678000190" })))).toBe(
      "invalid_input",
    );
  });
});

describe("product fiscal data", () => {
  async function product(orgId: string) {
    return withOrg(orgId, (tx) => createProduct(tx, orgId, { name: "Água" }));
  }
  const first = async (orgId: string) => (await withOrg(orgId, (tx) => listProducts(tx)))[0];

  it("starts with the defaults and no NCM", async () => {
    const orgId = await makeOrg("A");
    await product(orgId);
    expect(await first(orgId)).toMatchObject({ ncm: null, cest: null, cfop: "5102", csosn: "102", unit: "UN", origin: 0 });
  });

  it("saves the fiscal data and keeps omitted fields", async () => {
    const orgId = await makeOrg("A");
    const p = await product(orgId);
    await withOrg(orgId, (tx) =>
      updateProductFiscal(tx, p.id, { ncm: "22021000", cest: "0300100", cfop: "5405", csosn: "500", unit: "L", origin: 1 }),
    );
    expect(await first(orgId)).toMatchObject({
      ncm: "22021000",
      cest: "0300100",
      cfop: "5405",
      csosn: "500",
      unit: "L",
      origin: 1,
    });
    await withOrg(orgId, (tx) => updateProductFiscal(tx, p.id, { ncm: "22029900" }));
    expect(await first(orgId)).toMatchObject({ ncm: "22029900", cest: "0300100", unit: "L" });
  });

  it("refuses bad values", async () => {
    const orgId = await makeOrg("A");
    const p = await product(orgId);
    const run = (raw: object) => codeOf(withOrg(orgId, (tx) => updateProductFiscal(tx, p.id, raw)));
    expect(await run({ ncm: "2202100" })).toBe("invalid_input");
    expect(await run({ cest: "123" })).toBe("invalid_input");
    expect(await run({ cfop: "51" })).toBe("invalid_input");
    expect(await run({ csosn: "1022" })).toBe("invalid_input");
    expect(await run({ unit: "" })).toBe("invalid_input");
    expect(await run({ unit: "TOOLONG" })).toBe("invalid_input");
    expect(await run({ origin: 9 })).toBe("invalid_input");
  });

  it("does not find unknown, malformed or other-tenant products", async () => {
    const a = await makeOrg("A");
    const b = await makeOrg("B");
    const theirs = await product(b);
    const run = (id: string) => codeOf(withOrg(a, (tx) => updateProductFiscal(tx, id, { ncm: "22021000" })));
    expect(await run(UNKNOWN)).toBe("not_found");
    expect(await run("nope")).toBe("not_found");
    expect(await run(theirs.id)).toBe("not_found");
  });
});
