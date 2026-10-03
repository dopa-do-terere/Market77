import { beforeEach, expect, it } from "vitest";
import { adminSql } from "@/db/client";
import { withOrg } from "@/db/tenant";
import { startPayment } from "@/domain/payments";
import { addItemByBarcode } from "@/domain/sales";
import { buildFakeWebhook, fakeProvider } from "@/payments/fake";
import { reconcilePending } from "@/payments/reconcile";
import { makeOrg, resetDb, seedSellable, seedStore } from "../helpers";

beforeEach(resetDb);

const NOW = new Date("2026-10-02T12:00:00Z");

async function awaitingIn(name: string) {
  const orgId = await makeOrg(name);
  const store = await seedStore(orgId);
  await seedSellable(orgId, store.marketId, { barcode: "B-1", priceCents: 500 });
  const sale = await withOrg(orgId, (tx) => addItemByBarcode(tx, orgId, store, { barcode: "B-1" }, NOW));
  const view = await withOrg(orgId, (tx) => startPayment(tx, orgId, store, sale.id, fakeProvider, NOW));
  return { saleId: sale.id, externalId: view.payment!.qrPayload.split("|")[1] };
}

it("pays sales of every tenant whose provider already confirmed, and leaves the rest waiting", async () => {
  const a = await awaitingIn("A");
  const b = await awaitingIn("B");
  const c = await awaitingIn("C");
  buildFakeWebhook(a.externalId);
  buildFakeWebhook(b.externalId);
  const later = new Date(NOW.getTime() + 20_000);
  expect(await reconcilePending(later)).toBe(3);
  const rows = await adminSql`select id, status from sales order by created_at`;
  const byId = Object.fromEntries(rows.map((r) => [r.id as string, r.status as string]));
  expect([byId[a.saleId], byId[b.saleId], byId[c.saleId]]).toEqual(["paid", "paid", "awaiting_payment"]);
});
