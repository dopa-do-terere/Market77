import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adminSql } from "@/db/client";
import { withOrg } from "@/db/tenant";
import { startPayment } from "@/domain/payments";
import { addItemByBarcode } from "@/domain/sales";
import { buildFakeCardWebhook, fakeCardProvider } from "@/payments/fake-card";
import { fakeProvider } from "@/payments/fake";
import { POST as approveRoute } from "@/app/api/dev/fake-card/[externalId]/approve/route";
import { POST as declineRoute } from "@/app/api/dev/fake-card/[externalId]/decline/route";
import { POST as cardWebhookRoute } from "@/app/api/webhooks/card/[provider]/route";
import { makeOrg, resetDb, seedSellable, seedStore } from "../helpers";

beforeEach(resetDb);
afterEach(() => vi.unstubAllEnvs());

const NOW = new Date("2026-10-03T12:00:00Z");
const ctx = <T extends object>(p: T) => ({ params: Promise.resolve(p) });
const post = () => new Request("http://m77.test/x", { method: "POST" });

async function awaitingCard() {
  const orgId = await makeOrg("A");
  const store = await seedStore(orgId);
  await seedSellable(orgId, store.marketId, { barcode: "B-1", priceCents: 500 });
  const sale = await withOrg(orgId, (tx) => addItemByBarcode(tx, orgId, store, { barcode: "B-1" }, NOW));
  await withOrg(orgId, (tx) =>
    startPayment(tx, orgId, store, sale.id, fakeProvider, NOW, { method: "card", card: fakeCardProvider }),
  );
  const [p] = await adminSql`select external_id from payments where sale_id = ${sale.id}`;
  const status = async () => (await adminSql`select status from sales where id = ${sale.id}`)[0].status as string;
  return { externalId: p.external_id as string, status };
}

describe("card webhook route", () => {
  it("answers 401 to a forged webhook and 404 to an unknown provider, and confirms a signed one", async () => {
    const { externalId, status } = await awaitingCard();
    const forged = new Request("http://m77.test/x", { method: "POST", headers: { "x-fake-signature": "00" }, body: "{}" });
    expect((await cardWebhookRoute(forged, ctx({ provider: "fake" }))).status).toBe(401);
    const unknown = new Request("http://m77.test/x", { method: "POST", body: "{}" });
    expect((await cardWebhookRoute(unknown, ctx({ provider: "constructor" }))).status).toBe(404);
    const { headers, rawBody } = buildFakeCardWebhook(externalId, { status: "confirmed" });
    const ok = await cardWebhookRoute(
      new Request("http://m77.test/x", { method: "POST", headers, body: rawBody }),
      ctx({ provider: "fake" }),
    );
    expect([ok.status, await ok.json()]).toEqual([200, { result: "confirmed" }]);
    expect(await status()).toBe("paid");
  });
});

describe("dev fake card routes", () => {
  it("approve pays the sale through the real webhook path", async () => {
    const { externalId, status } = await awaitingCard();
    const res = await approveRoute(post(), ctx({ externalId }));
    expect([res.status, await res.json()]).toEqual([200, { result: "confirmed" }]);
    expect(await status()).toBe("paid");
  });

  it("decline puts the sale back at the cart", async () => {
    const { externalId, status } = await awaitingCard();
    const res = await declineRoute(post(), ctx({ externalId }));
    expect([res.status, await res.json()]).toEqual([200, { result: "failed" }]);
    expect(await status()).toBe("open");
  });

  it("answer 404 in production", async () => {
    const { externalId } = await awaitingCard();
    vi.stubEnv("NODE_ENV", "production");
    expect((await approveRoute(post(), ctx({ externalId }))).status).toBe(404);
    expect((await declineRoute(post(), ctx({ externalId }))).status).toBe(404);
  });
});
