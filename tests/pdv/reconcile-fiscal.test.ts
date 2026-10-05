import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { POST as reconcileRoute } from "@/app/api/internal/reconcile/route";
import { adminSql } from "@/db/client";
import { resetFakeFiscal } from "@/fiscal/fake-fiscal";
import { fiscalShop, makeOrg, paidSale, resetDb } from "../helpers";

beforeEach(async () => {
  await resetDb();
  resetFakeFiscal();
});
afterEach(() => vi.unstubAllEnvs());

it("the reconcile route also issues the pending fiscal documents", async () => {
  vi.stubEnv("RECONCILE_SECRET", "s3cret");
  const orgId = await makeOrg("A");
  const shop = await fiscalShop(orgId);
  const saleId = await paidSale(orgId, shop, shop.barcode, 1, { now: new Date() });
  const res = await reconcileRoute(
    new Request("http://m77.test/api/internal/reconcile", { method: "POST", headers: { "x-reconcile-secret": "s3cret" } }),
  );
  expect([res.status, await res.json()]).toEqual([200, { visited: 0, fiscal: 1 }]);
  const [d] = await adminSql`select status from fiscal_documents where sale_id = ${saleId}`;
  expect(d.status).toBe("issued");
});
