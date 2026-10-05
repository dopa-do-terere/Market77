import { beforeEach, describe, expect, it, vi } from "vitest";
import { adminSql } from "@/db/client";
import { withOrg } from "@/db/tenant";
import { saveMercadoPagoCredentials } from "@/domain/credentials";
import { setTerminalDevice } from "@/domain/terminals";
import { startPayment } from "@/domain/payments";
import { addItemByBarcode } from "@/domain/sales";
import { resolveCard, resolvePix } from "@/payments/registry";
import { makeOrg, resetDb, seedSellable, seedStore } from "../helpers";
import { fakeFetch } from "./mp-fetch";

beforeEach(resetDb);

const CREDS = { accessToken: "APP_USR-token-1234", webhookSecret: "whsec-123456" };
const NOW = new Date("2026-10-05T12:00:00Z");
const connect = (orgId: string) => withOrg(orgId, (tx) => saveMercadoPagoCredentials(tx, orgId, CREDS));

describe("per-organization provider registry", () => {
  it("falls back to the fake provider without credentials", async () => {
    const orgId = await makeOrg("A");
    expect((await withOrg(orgId, (tx) => resolvePix(tx))).name).toBe("fake");
    expect((await withOrg(orgId, (tx) => resolveCard(tx))).name).toBe("fake");
  });

  it("uses Mercado Pago for the organization that connected it, and only for it", async () => {
    const a = await makeOrg("A");
    const b = await makeOrg("B");
    await connect(a);
    expect((await withOrg(a, (tx) => resolvePix(tx))).name).toBe("mercadopago");
    expect((await withOrg(a, (tx) => resolveCard(tx))).name).toBe("mercadopago");
    expect((await withOrg(b, (tx) => resolvePix(tx))).name).toBe("fake");
    expect((await withOrg(b, (tx) => resolveCard(tx))).name).toBe("fake");
  });

  it("uses the credentials of the organization in every call", async () => {
    const a = await makeOrg("A");
    await connect(a);
    const { f, calls } = fakeFetch(() => ({
      json: { id: 1, point_of_interaction: { transaction_data: { qr_code: "x" } } },
    }));
    const p = await withOrg(a, (tx) => resolvePix(tx, f));
    await p.createPixCharge({ saleId: "s", amountCents: 100, expiresAt: new Date(NOW.getTime() + 180_000) });
    expect(calls[0].headers.Authorization).toBe(`Bearer ${CREDS.accessToken}`);
  });

  it("goes back to the fake provider after the credentials are removed", async () => {
    const a = await makeOrg("A");
    await connect(a);
    await adminSql`delete from provider_credentials`;
    expect((await withOrg(a, (tx) => resolvePix(tx))).name).toBe("fake");
  });

  it("answers provider_unavailable when the stored secret cannot be decrypted", async () => {
    const a = await makeOrg("A");
    await connect(a);
    await adminSql`update provider_credentials set access_token_enc = 'v1:AAAA:AAAA:AAAA'`;
    await expect(withOrg(a, (tx) => resolvePix(tx))).rejects.toMatchObject({ code: "provider_unavailable" });
    await expect(withOrg(a, (tx) => resolveCard(tx))).rejects.toMatchObject({ code: "provider_unavailable" });
  });

  it("answers provider_unavailable when the server lost its key", async () => {
    const a = await makeOrg("A");
    await connect(a);
    vi.stubEnv("CREDENTIALS_KEY", "");
    await expect(withOrg(a, (tx) => resolvePix(tx))).rejects.toMatchObject({ code: "provider_unavailable" });
    vi.unstubAllEnvs();
  });

  it("sends the card charge to the Point machine of the totem", async () => {
    const a = await makeOrg("A");
    const { terminalId } = await seedStore(a);
    await connect(a);
    await withOrg(a, (tx) => setTerminalDevice(tx, terminalId, { pointDeviceId: "NEWLAND_N950__X1" }));
    const { f, calls } = fakeFetch(() => ({ json: { id: "ORD1", status: "created", total_amount: "1.00" } }));
    // The lookup of the Point machine runs on the transaction that resolved the provider, so charge inside it.
    await withOrg(a, async (tx) =>
      (await resolveCard(tx, f)).createCardCharge({
        saleId: "s",
        amountCents: 100,
        terminalId,
        expiresAt: new Date(Date.now() + 120_000),
      }),
    );
    expect((calls[0].body as { config: { point: { terminal_id: string } } }).config.point.terminal_id).toBe(
      "NEWLAND_N950__X1",
    );
  });

  it("a totem without a Point machine cannot start a card payment, and the sale stays consistent", async () => {
    const a = await makeOrg("A");
    const store = await seedStore(a);
    await seedSellable(a, store.marketId, { barcode: "7891000100103", priceCents: 500 });
    await connect(a);
    const sale = await withOrg(a, (tx) => addItemByBarcode(tx, a, store, { barcode: "7891000100103" }, NOW));
    const { f } = fakeFetch(() => ({ json: {} }));
    const err = await withOrg(a, async (tx) =>
      startPayment(tx, a, store, sale.id, await resolvePix(tx, f), NOW, { method: "card", card: await resolveCard(tx, f) }),
    ).catch((e) => e);
    expect(err).toMatchObject({ code: "provider_unavailable" });
    const [s] = await adminSql`select status from sales where id = ${sale.id}`;
    expect(s.status).toBe("open");
    expect(await adminSql`select 1 from payments`).toHaveLength(0);
  });
});
