import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adminSql } from "@/db/client";
import { withOrg } from "@/db/tenant";
import { backoffMinutes, processFiscalQueue, reissueFiscalDocument } from "@/domain/fiscal";
import { resetFakeFiscal, setFakeFiscalMode } from "@/fiscal/fake-fiscal";
import { codeOf, fiscalShop, makeOrg, paidSale, resetDb } from "../helpers";

beforeEach(async () => {
  await resetDb();
  resetFakeFiscal();
});
afterEach(() => vi.restoreAllMocks());

const NOW = new Date("2026-10-03T15:00:00Z");
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);
const doc = async (saleId: string) =>
  (
    await adminSql`
      select status, attempts, last_error, number, access_key, next_attempt_at, payload
      from fiscal_documents where sale_id = ${saleId}`
  )[0];

async function queued(o: { enabled?: boolean; ncm?: string | null } = {}) {
  const orgId = await makeOrg("A");
  const shop = await fiscalShop(orgId, o);
  const saleId = await paidSale(orgId, shop, shop.barcode, 1);
  return { orgId, shop, saleId };
}

describe("backoff", () => {
  it("doubles from one minute up to one hour", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(backoffMinutes)).toEqual([1, 2, 4, 8, 16, 32, 60, 60]);
  });
});

describe("processing the queue", () => {
  it("issues a due document once", async () => {
    const { saleId } = await queued();
    expect(await processFiscalQueue(NOW)).toBe(1);
    const d = await doc(saleId);
    expect([d.status, d.attempts, d.number, d.last_error]).toEqual(["issued", 1, 1, null]);
    expect(d.access_key).toMatch(/^\d{44}$/);
    expect(await processFiscalQueue(NOW)).toBe(0);
  });

  it("leaves a document that is not due yet alone", async () => {
    const { saleId } = await queued();
    await adminSql`update fiscal_documents set next_attempt_at = ${minutes(10)}`;
    expect(await processFiscalQueue(NOW)).toBe(0);
    expect((await doc(saleId)).status).toBe("pending");
  });

  it("retries a provider that is down with growing waits, then gives up on the 8th failure", async () => {
    const { saleId } = await queued();
    setFakeFiscalMode("down");
    let at = NOW;
    const waits: number[] = [];
    for (let k = 1; k <= 7; k++) {
      expect(await processFiscalQueue(at)).toBe(1);
      const d = await doc(saleId);
      expect([d.status, d.attempts]).toEqual(["pending", k]);
      waits.push((d.next_attempt_at.getTime() - at.getTime()) / 60_000);
      at = d.next_attempt_at;
    }
    expect(waits).toEqual([1, 2, 4, 8, 16, 32, 60]);
    expect(await processFiscalQueue(at)).toBe(1);
    const d = await doc(saleId);
    expect([d.status, d.attempts]).toEqual(["error", 8]);
    expect(d.last_error).toMatch(/^unavailable:/);
    expect(await processFiscalQueue(new Date(at.getTime() + 3_600_000))).toBe(0);
  });

  it("turns a provider rejection into an error at once, without retry", async () => {
    const { saleId } = await queued();
    setFakeFiscalMode("reject");
    expect(await processFiscalQueue(NOW)).toBe(1);
    const d = await doc(saleId);
    expect([d.status, d.attempts]).toEqual(["error", 1]);
    expect(d.last_error).toMatch(/^fake_rejected:/);
    expect(await processFiscalQueue(minutes(5))).toBe(0);
  });

  it("refuses the normal tax regime without calling the provider", async () => {
    const orgId = await makeOrg("A");
    const shop = await fiscalShop(orgId);
    await adminSql`update markets set tax_regime = 'normal' where id = ${shop.marketId}`;
    const saleId = await paidSale(orgId, shop, shop.barcode, 1);
    await processFiscalQueue(NOW);
    const d = await doc(saleId);
    expect(d.status).toBe("error");
    expect(d.last_error).toMatch(/^unsupported_regime:/);
    const other = await queued();
    await processFiscalQueue(NOW);
    expect((await doc(other.saleId)).number).toBe(1); // the refused one never used a number
  });

  it("names the product that has no NCM", async () => {
    const { saleId } = await queued({ ncm: null });
    await processFiscalQueue(NOW);
    const d = await doc(saleId);
    expect(d.status).toBe("error");
    expect(d.last_error).toMatch(/^missing_ncm:.*Água/);
  });

  it.each([
    ["update markets set cnpj = '11111111111111'", "invalid_cnpj"],
    ["update markets set state_registration = null", "missing_state_registration"],
    ["update markets set uf = null", "missing_uf"],
  ])("refuses bad emitter data (%s)", async (sql, code) => {
    const orgId = await makeOrg("A");
    const shop = await fiscalShop(orgId);
    await adminSql.unsafe(`${sql} where id = '${shop.marketId}'`);
    const saleId = await paidSale(orgId, shop, shop.barcode, 1);
    await processFiscalQueue(NOW);
    const d = await doc(saleId);
    expect(d.status).toBe("error");
    expect(d.last_error).toMatch(new RegExp(`^${code}:`));
  });

  it("does not issue twice when the provider lost its answer", async () => {
    const { orgId, shop, saleId } = await queued();
    setFakeFiscalMode("lost");
    await processFiscalQueue(NOW);
    expect([(await doc(saleId)).status, (await doc(saleId)).attempts]).toEqual(["pending", 1]);
    setFakeFiscalMode("ok");
    await processFiscalQueue(minutes(1));
    const d = await doc(saleId);
    expect([d.status, d.number]).toEqual(["issued", 1]);
    const second = await paidSale(orgId, shop, shop.barcode, 1);
    await processFiscalQueue(minutes(1));
    expect((await doc(second)).number).toBe(2);
  });

  it("keeps going when one document blows up", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { orgId, shop, saleId: first } = await queued();
    const second = await paidSale(orgId, shop, shop.barcode, 1);
    await adminSql`update fiscal_documents set payload = '{}'::jsonb where sale_id = ${first}`;
    expect(await processFiscalQueue(NOW)).toBe(2);
    const a = await doc(first);
    expect([a.status, a.attempts]).toEqual(["pending", 1]);
    expect((await doc(second)).status).toBe("issued");
  });

  it("treats an unexpected provider error as a reason to retry", async () => {
    const { saleId } = await queued();
    const broken = {
      name: "broken",
      issueNfce: async () => {
        throw new Error("boom");
      },
      getByRef: async () => null,
    };
    await processFiscalQueue(NOW, 50, broken);
    const d = await doc(saleId);
    expect([d.status, d.attempts]).toEqual(["pending", 1]);
    expect(d.last_error).toMatch(/boom/);
  });

  it("emits each document once when two processors run together", async () => {
    const { orgId, shop, saleId: first } = await queued();
    const second = await paidSale(orgId, shop, shop.barcode, 1);
    const [a, b] = await Promise.all([processFiscalQueue(NOW), processFiscalQueue(NOW)]);
    expect(a + b).toBe(2);
    const numbers = [(await doc(first)).number, (await doc(second)).number].sort();
    expect(numbers).toEqual([1, 2]);
  });
});

describe("reissue", () => {
  it("rebuilds the snapshot from the current registration and queues it again", async () => {
    const { orgId, shop, saleId } = await queued({ ncm: null });
    await processFiscalQueue(NOW);
    expect((await doc(saleId)).status).toBe("error");
    await adminSql`update products set ncm = '22021000' where id = ${shop.productId}`;
    await withOrg(orgId, (tx) => reissueFiscalDocument(tx, saleId, minutes(2)));
    const d = await doc(saleId);
    expect([d.status, d.attempts, d.last_error]).toEqual(["pending", 0, null]);
    expect((d.payload as { items: { ncm: string }[] }).items[0].ncm).toBe("22021000");
    await processFiscalQueue(minutes(2));
    expect((await doc(saleId)).status).toBe("issued");
  });

  it("only reissues documents with an error and knows unknown sales", async () => {
    const { orgId, saleId } = await queued();
    const run = (id: string) => withOrg(orgId, (tx) => reissueFiscalDocument(tx, id, NOW));
    expect(await codeOf(run(saleId))).toBe("invalid_input"); // still pending
    await processFiscalQueue(NOW);
    expect(await codeOf(run(saleId))).toBe("invalid_input"); // issued
    expect(await codeOf(run("00000000-0000-4000-8000-000000000000"))).toBe("not_found");
    expect(await codeOf(run("nope"))).toBe("not_found");
  });
});
