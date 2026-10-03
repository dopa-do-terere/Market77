import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withOrg } from "@/db/tenant";
import { createTerminal, revokeTerminal } from "@/domain/terminals";
import { buildFakeWebhook } from "@/payments/fake";
import {
  cancelHandler, getSaleHandler, payHandler, pingHandler, scanHandler, setQuantityHandler,
} from "@/pdv/http";
import { handleProviderWebhook } from "@/payments/webhook";
import { makeOrg, resetDb, seedSellable, seedStore } from "../helpers";

beforeEach(resetDb);
afterEach(() => vi.unstubAllEnvs());

const BARCODE = "7891000100103";

const call = (token: string | undefined, body?: unknown, raw?: string) =>
  new Request("http://m77.test/api/pdv/x", {
    method: "POST",
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });

async function setup() {
  const orgId = await makeOrg("A");
  const store = await seedStore(orgId);
  await seedSellable(orgId, store.marketId, { barcode: BARCODE, priceCents: 500 });
  const { id, token } = await withOrg(orgId, (tx) =>
    createTerminal(tx, orgId, { marketId: store.marketId, name: "Totem 1" }),
  );
  return { orgId, store, terminalId: id, token };
}
type Setup = Awaited<ReturnType<typeof setup>>;

const json = async (res: Response) => (await res.json()) as Record<string, any>;
async function scan(s: Setup, saleId?: string, barcode = BARCODE) {
  return json(await scanHandler(call(s.token, { saleId, barcode })));
}

describe("terminal authentication", () => {
  it("answers 401 without a token, with a garbage token and with a revoked token", async () => {
    const s = await setup();
    expect((await pingHandler(call(undefined))).status).toBe(401);
    const garbage = await pingHandler(call("garbage"));
    expect([garbage.status, (await json(garbage)).error]).toEqual([401, "unauthorized"]);
    await withOrg(s.orgId, (tx) => revokeTerminal(tx, s.terminalId));
    const revoked = await pingHandler(call(s.token));
    expect([revoked.status, (await json(revoked)).error]).toEqual([401, "terminal_revoked"]);
  });

  it("answers ok to a valid token", async () => {
    const s = await setup();
    expect(await json(await pingHandler(call(s.token)))).toEqual({ ok: true });
  });
});

describe("scan and edit", () => {
  it("creates a sale with the scanned item", async () => {
    const s = await setup();
    const sale = await scan(s);
    expect([sale.status, sale.totalCents, sale.items[0].quantity]).toEqual(["open", 500, 1]);
    expect(typeof sale.expiresAt).toBe("string");
  });

  it("answers 404 for an unknown barcode, 400 for a broken body and 404 for a malformed sale id", async () => {
    const s = await setup();
    const unknown = await scanHandler(call(s.token, { barcode: "0000" }));
    expect([unknown.status, (await json(unknown)).error]).toEqual([404, "product_not_found"]);
    expect((await scanHandler(call(s.token, undefined, "{not json"))).status).toBe(400);
    expect((await scanHandler(call(s.token, { barcode: "" }))).status).toBe(400);
    const emptySale = await scanHandler(call(s.token, { saleId: "", barcode: BARCODE }));
    expect([emptySale.status, (await json(emptySale)).error]).toEqual([400, "invalid_input"]);
    const bad = await scanHandler(call(s.token, { saleId: "nope", barcode: BARCODE }));
    expect([bad.status, (await json(bad)).error]).toEqual([404, "sale_not_found"]);
  });

  it("changes a quantity and rejects bad ones without a 500", async () => {
    const s = await setup();
    const sale = await scan(s);
    const itemId = sale.items[0].id;
    const patch = (id: string, quantity: unknown) =>
      setQuantityHandler(call(s.token, { quantity }), sale.id, id);
    const ok = await patch(itemId, 3);
    expect([ok.status, (await json(ok)).totalCents]).toEqual([200, 1500]);
    expect((await patch(itemId, 100)).status).toBe(400);
    expect((await patch(itemId, "x")).status).toBe(400);
    expect((await patch("nope", 1)).status).toBe(404);
  });
});

describe("payment flow", () => {
  it("pays through the webhook and the totem sees the sale paid", async () => {
    const s = await setup();
    const sale = await scan(s);
    const payRes = await payHandler(call(s.token), sale.id);
    const paying = await json(payRes);
    expect([payRes.status, paying.status]).toEqual([200, "awaiting_payment"]);
    expect(paying.payment.qrPayload).toMatch(/^FAKEPIX\|/);
    const waiting = await json(await getSaleHandler(call(s.token), sale.id));
    expect(waiting.status).toBe("awaiting_payment");
    const externalId = paying.payment.qrPayload.split("|")[1];
    const { headers, rawBody } = buildFakeWebhook(externalId);
    expect((await handleProviderWebhook("fake", headers, rawBody)).body.result).toBe("confirmed");
    expect((await json(await getSaleHandler(call(s.token), sale.id))).status).toBe("paid");
  });

  it("answers 422 sale_empty and 409 once the sale is cancelled", async () => {
    const s = await setup();
    const sale = await scan(s);
    await setQuantityHandler(call(s.token, { quantity: 0 }), sale.id, sale.items[0].id);
    const empty = await payHandler(call(s.token), sale.id);
    expect([empty.status, (await json(empty)).error]).toEqual([422, "sale_empty"]);
    const cancelled = await json(await cancelHandler(call(s.token), sale.id));
    expect(cancelled.status).toBe("cancelled");
    const again = await payHandler(call(s.token), sale.id);
    expect([again.status, (await json(again)).error]).toEqual([409, "sale_not_editable"]);
  });

  it("answers 503 provider_unavailable when the provider cannot create the charge", async () => {
    const s = await setup();
    const sale = await scan(s);
    vi.stubEnv("FAKE_PIX_SECRET", "");
    const res = await payHandler(call(s.token), sale.id);
    expect([res.status, (await json(res)).error]).toEqual([503, "provider_unavailable"]);
  });
});

describe("isolation", () => {
  it("hides a sale from another terminal of the same organization and from another organization", async () => {
    const s = await setup();
    const sale = await scan(s);
    const second = await withOrg(s.orgId, (tx) =>
      createTerminal(tx, s.orgId, { marketId: s.store.marketId, name: "Totem 2" }),
    );
    expect((await getSaleHandler(call(second.token), sale.id)).status).toBe(404);
    const other = await setup();
    expect((await getSaleHandler(call(other.token), sale.id)).status).toBe(404);
    expect((await cancelHandler(call(other.token), sale.id)).status).toBe(404);
  });
});
