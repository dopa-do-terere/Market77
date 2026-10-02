import { beforeEach, describe, expect, it } from "vitest";
import { withOrg } from "@/db/tenant";
import { createProduct, listProducts } from "@/domain/products";
import { AppError } from "@/lib/errors";
import { makeOrg, resetDb } from "../helpers";

beforeEach(resetDb);

const agua = { name: "Água 500ml", category: "Bebidas", barcodes: ["7891000100103"] };

describe("products", () => {
  it("creates a product with barcodes and lists it", async () => {
    const a = await makeOrg("A");
    await withOrg(a, (tx) => createProduct(tx, a, { ...agua, barcodes: ["7891000100103", "AGUA-01"] }));
    const [p] = await withOrg(a, (tx) => listProducts(tx));
    expect(p.name).toBe("Água 500ml");
    expect(p.barcodes).toEqual(["7891000100103", "AGUA-01"]);
  });

  it("dedupes repeated barcodes inside one request", async () => {
    const a = await makeOrg("A");
    const p = await withOrg(a, (tx) => createProduct(tx, a, { name: "Suco", barcodes: ["12345678", "12345678"] }));
    expect(p.barcodes).toEqual(["12345678"]);
  });

  it("rejects a barcode already used in the org and rolls the product back", async () => {
    const a = await makeOrg("A");
    await withOrg(a, (tx) => createProduct(tx, a, agua));
    const err = await withOrg(a, (tx) => createProduct(tx, a, { name: "Outra água", barcodes: agua.barcodes })).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("barcode_taken");
    expect((await withOrg(a, (tx) => listProducts(tx))).map((p) => p.name)).toEqual(["Água 500ml"]);
  });

  it("allows the same barcode in two different orgs", async () => {
    const a = await makeOrg("A");
    const b = await makeOrg("B");
    await withOrg(a, (tx) => createProduct(tx, a, agua));
    await expect(withOrg(b, (tx) => createProduct(tx, b, agua))).resolves.toBeDefined();
  });

  it("rejects malformed barcodes", async () => {
    const a = await makeOrg("A");
    await expect(
      withOrg(a, (tx) => createProduct(tx, a, { name: "Suco", barcodes: ["ab"] })),
    ).rejects.toBeInstanceOf(AppError);
  });
});
