import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withOrg } from "@/db/tenant";
import { startPayment } from "@/domain/payments";
import { addItemByBarcode } from "@/domain/sales";
import { buildFakeWebhook, fakeProvider } from "@/payments/fake";
import { POST as reconcileRoute } from "@/app/api/internal/reconcile/route";
import { POST as devPayRoute } from "@/app/api/dev/fake-pix/[externalId]/pay/route";
import { POST as webhookRoute } from "@/app/api/webhooks/pix/[provider]/route";
import { makeOrg, resetDb, seedSellable, seedStore } from "../helpers";

beforeEach(resetDb);
afterEach(() => vi.unstubAllEnvs());

const NOW = new Date("2026-10-02T12:00:00Z");
const ctx = <T extends object>(p: T) => ({ params: Promise.resolve(p) });

async function awaiting() {
  const orgId = await makeOrg("A");
  const store = await seedStore(orgId);
  await seedSellable(orgId, store.marketId, { barcode: "B-1", priceCents: 500 });
  const sale = await withOrg(orgId, (tx) => addItemByBarcode(tx, orgId, store, { barcode: "B-1" }, NOW));
  const view = await withOrg(orgId, (tx) => startPayment(tx, orgId, store, sale.id, fakeProvider, NOW));
  return view.payment!.qrPayload!.split("|")[1];
}

describe("webhook route", () => {
  it("answers 401 to a forged webhook and 404 to an unknown provider", async () => {
    const forged = new Request("http://m77.test/api/webhooks/pix/fake", {
      method: "POST",
      headers: { "x-fake-signature": "00" },
      body: "{}",
    });
    expect((await webhookRoute(forged, ctx({ provider: "fake" }))).status).toBe(401);
    const unknown = new Request("http://m77.test/x", { method: "POST", body: "{}" });
    expect((await webhookRoute(unknown, ctx({ provider: "constructor" }))).status).toBe(404);
  });

  it("confirms through the real route with a signed body", async () => {
    const externalId = await awaiting();
    const { headers, rawBody } = buildFakeWebhook(externalId);
    const res = await webhookRoute(
      new Request("http://m77.test/x", { method: "POST", headers, body: rawBody }),
      ctx({ provider: "fake" }),
    );
    expect([res.status, await res.json()]).toEqual([200, { result: "confirmed" }]);
  });
});

describe("dev fake-pay route", () => {
  it("pays a charge outside production and is a 404 in production", async () => {
    const externalId = await awaiting();
    const ok = await devPayRoute(new Request("http://m77.test/x", { method: "POST" }), ctx({ externalId }));
    expect([ok.status, await ok.json()]).toEqual([200, { result: "confirmed" }]);
    vi.stubEnv("NODE_ENV", "production");
    const blocked = await devPayRoute(new Request("http://m77.test/x", { method: "POST" }), ctx({ externalId }));
    expect(blocked.status).toBe(404);
  });
});

describe("reconcile route", () => {
  const call = (secret?: string) =>
    reconcileRoute(
      new Request("http://m77.test/api/internal/reconcile", {
        method: "POST",
        headers: secret ? { "x-reconcile-secret": secret } : {},
      }),
    );

  it("is a 404 without a configured secret, 401 with a wrong one and 200 with the right one", async () => {
    vi.stubEnv("RECONCILE_SECRET", "");
    expect((await call("anything")).status).toBe(404);
    vi.stubEnv("RECONCILE_SECRET", "s3cret");
    expect((await call()).status).toBe(401);
    expect((await call("wrong!")).status).toBe(401);
    const ok = await call("s3cret");
    expect([ok.status, await ok.json()]).toEqual([200, { visited: 0 }]);
  });
});
