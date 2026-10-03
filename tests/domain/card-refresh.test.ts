import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adminSql } from "@/db/client";
import { withOrg } from "@/db/tenant";
import { CARD_TTL_MS, startPayment } from "@/domain/payments";
import { CARD_CHECK_INTERVAL_MS, refreshSale } from "@/domain/refresh";
import { addItemByBarcode } from "@/domain/sales";
import { getBalance } from "@/domain/stock";
import type { CardProvider } from "@/payments/card";
import { fakeProvider } from "@/payments/fake";
import { buildFakeCardWebhook, fakeCardProvider } from "@/payments/fake-card";
import { reconcilePending } from "@/payments/reconcile";
import { makeOrg, resetDb, seedSellable, seedStore } from "../helpers";

beforeEach(resetDb);
afterEach(() => vi.unstubAllEnvs());

const NOW = new Date("2026-10-03T12:00:00Z");
const at = (ms: number) => new Date(NOW.getTime() + ms);
const BARCODE = "7891000100103";

async function awaiting(method: "card" | "pix") {
  const orgId = await makeOrg("A");
  const store = await seedStore(orgId);
  const item = await seedSellable(orgId, store.marketId, { barcode: BARCODE, priceCents: 500 });
  const sale = await withOrg(orgId, (tx) => addItemByBarcode(tx, orgId, store, { barcode: BARCODE }, NOW));
  await withOrg(orgId, (tx) =>
    startPayment(tx, orgId, store, sale.id, fakeProvider, NOW, { method, card: fakeCardProvider }),
  );
  const [p] = await adminSql`select id, external_id from payments where sale_id = ${sale.id}`;
  const refresh = (now: Date, card: CardProvider = fakeCardProvider) =>
    withOrg(orgId, (tx) => refreshSale(tx, store, sale.id, fakeProvider, now, card));
  const rows = () => adminSql`select status, failure_reason from payments where sale_id = ${sale.id} order by created_at, id`;
  return { orgId, store, item, saleId: sale.id, externalId: p.external_id as string, refresh, rows };
}

const spy = () => {
  const calls = { get: 0, cancel: 0 };
  const card: CardProvider = {
    ...fakeCardProvider,
    getCharge: async (id) => {
      calls.get++;
      return fakeCardProvider.getCharge(id);
    },
    cancelCardCharge: async (id) => {
      calls.cancel++;
      return fakeCardProvider.cancelCardCharge(id);
    },
  };
  return { calls, card };
};

describe("refreshSale with a card payment", () => {
  it("asks the card provider at most once every 2 seconds", async () => {
    const r = await awaiting("card");
    const { calls, card } = spy();
    expect((await r.refresh(at(500), card)).status).toBe("awaiting_payment");
    expect(calls.get).toBe(1);
    await r.refresh(at(1500), card);
    expect(calls.get).toBe(1);
    await r.refresh(at(500 + CARD_CHECK_INTERVAL_MS), card);
    expect(calls.get).toBe(2);
  });

  it("pays the sale when the machine approved", async () => {
    const r = await awaiting("card");
    buildFakeCardWebhook(r.externalId, { status: "confirmed" });
    expect((await r.refresh(at(CARD_CHECK_INTERVAL_MS))).status).toBe("paid");
    expect(await withOrg(r.orgId, (tx) => getBalance(tx, r.item.marketProductId))).toBe(-1);
  });

  it("puts the sale back at the cart with the reason when the card was declined", async () => {
    const r = await awaiting("card");
    buildFakeCardWebhook(r.externalId, { status: "failed", failureReason: "declined" });
    const view = await r.refresh(at(CARD_CHECK_INTERVAL_MS));
    expect(view.status).toBe("open");
    expect(view.paymentFailure).toEqual({ method: "card", reason: "declined" });
    expect((await r.rows()).map((p) => [p.status, p.failure_reason])).toEqual([["failed", "declined"]]);
  });

  it("reports a charge cancelled on the machine as cancelled", async () => {
    const r = await awaiting("card");
    await fakeCardProvider.cancelCardCharge(r.externalId);
    const view = await r.refresh(at(CARD_CHECK_INTERVAL_MS));
    expect(view.paymentFailure).toEqual({ method: "card", reason: "cancelled" });
  });

  it("expires the charge when the time ran out, and tells the machine to stop", async () => {
    const r = await awaiting("card");
    const { calls, card } = spy();
    const view = await r.refresh(at(CARD_TTL_MS + 3000), card);
    expect(view.status).toBe("open");
    expect(view.paymentFailure).toEqual({ method: "card", reason: "expired" });
    expect((await r.rows()).map((p) => [p.status, p.failure_reason])).toEqual([["expired", "expired"]]);
    expect(calls.cancel).toBe(1);
  });

  it("pays the sale when the machine approves while the cancel is a no-op at expiry", async () => {
    const r = await awaiting("card");
    const card: CardProvider = {
      ...fakeCardProvider,
      cancelCardCharge: async (id) => {
        buildFakeCardWebhook(id, { status: "confirmed" });
      },
    };
    expect((await r.refresh(at(CARD_TTL_MS + 3000), card)).status).toBe("paid");
  });

  it("keeps the payment pending when the provider is down at expiry", async () => {
    const r = await awaiting("card");
    const down = async () => {
      throw new Error("down");
    };
    const card: CardProvider = { ...fakeCardProvider, cancelCardCharge: down, getCharge: down };
    expect((await r.refresh(at(CARD_TTL_MS + 3000), card)).status).toBe("awaiting_payment");
    expect((await r.rows()).map((p) => p.status)).toEqual(["pending"]);
  });

  it("keeps the payment pending when the cancel fails and the machine still waits", async () => {
    const r = await awaiting("card");
    const card: CardProvider = {
      ...fakeCardProvider,
      cancelCardCharge: async () => {
        throw new Error("down");
      },
    };
    expect((await r.refresh(at(CARD_TTL_MS + 3000), card)).status).toBe("awaiting_payment");
    expect((await r.rows()).map((p) => p.status)).toEqual(["pending"]);
  });

  it("keeps the payment pending at expiry when no card provider can be resolved", async () => {
    const r = await awaiting("card");
    vi.stubEnv("CARD_PROVIDER", "nope");
    const view = await withOrg(r.orgId, (tx) =>
      refreshSale(tx, r.store, r.saleId, fakeProvider, at(CARD_TTL_MS + 3000)),
    );
    expect(view.status).toBe("awaiting_payment");
    expect((await r.rows()).map((p) => p.status)).toEqual(["pending"]);
  });

  it("keeps waiting while the provider is down", async () => {
    const r = await awaiting("card");
    const broken: CardProvider = { ...fakeCardProvider, getCharge: async () => { throw new Error("down"); } };
    expect((await r.refresh(at(CARD_CHECK_INTERVAL_MS), broken)).status).toBe("awaiting_payment");
  });

  it("keeps waiting, without failing, when the configured card provider is unknown", async () => {
    const r = await awaiting("card");
    vi.stubEnv("CARD_PROVIDER", "nope");
    const view = await withOrg(r.orgId, (tx) =>
      refreshSale(tx, r.store, r.saleId, fakeProvider, at(CARD_CHECK_INTERVAL_MS)),
    );
    expect(view.status).toBe("awaiting_payment");
  });
});

describe("refreshSale with a Pix payment after phase 4", () => {
  it("records the reason when a Pix payment expires", async () => {
    const r = await awaiting("pix");
    const view = await r.refresh(at(4 * 60_000));
    expect(view.status).toBe("open");
    expect((await r.rows()).map((p) => [p.status, p.failure_reason])).toEqual([["expired", "expired"]]);
  });
});

describe("reconcilePending with a card payment", () => {
  it("pays a card sale whose approval webhook was lost", async () => {
    const r = await awaiting("card");
    buildFakeCardWebhook(r.externalId, { status: "confirmed" });
    expect(await reconcilePending(at(CARD_CHECK_INTERVAL_MS))).toBe(1);
    const [s] = await adminSql`select status from sales where id = ${r.saleId}`;
    expect(s.status).toBe("paid");
  });
});
