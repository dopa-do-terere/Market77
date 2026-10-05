import { beforeEach, describe, expect, it } from "vitest";
import { adminSql } from "@/db/client";
import { withOrg } from "@/db/tenant";
import { makeOrg, resetDb, seedStore } from "../helpers";

beforeEach(resetDb);

const insert = (orgId: string, provider = "mercadopago", last4 = "abcd") =>
  withOrg(orgId, (tx) =>
    tx`insert into provider_credentials (org_id, provider, access_token_enc, webhook_secret_enc, token_last4)
       values (${orgId}, ${provider}, 'v1:a:b:c', 'v1:d:e:f', ${last4})`,
  );

describe("phase 7 schema", () => {
  it("allows one row per organization and provider, and only mercadopago", async () => {
    const orgId = await makeOrg("A");
    await insert(orgId);
    await expect(insert(orgId)).rejects.toThrow(/duplicate|unique/);
    await expect(insert(await makeOrg("B"), "stone")).rejects.toThrow(/check/);
    await expect(insert(await makeOrg("C"), "mercadopago", "abc")).rejects.toThrow(/check/);
  });

  it("isolates credentials by organization", async () => {
    const a = await makeOrg("A");
    const b = await makeOrg("B");
    await insert(a);
    const seenByB = await withOrg(b, (tx) => tx`select id from provider_credentials`);
    expect(seenByB).toHaveLength(0);
    await expect(
      withOrg(b, (tx) =>
        tx`insert into provider_credentials (org_id, provider, access_token_enc, webhook_secret_enc, token_last4)
           values (${a}, 'mercadopago', 'x', 'y', 'abcd')`,
      ),
    ).rejects.toThrow();
  });

  it("limits the Point device id of a terminal", async () => {
    const orgId = await makeOrg("A");
    const { terminalId } = await seedStore(orgId);
    await withOrg(orgId, (tx) => tx`update terminals set point_device_id = 'NEWLAND_N950__X1' where id = ${terminalId}`);
    await expect(
      withOrg(orgId, (tx) => tx`update terminals set point_device_id = '' where id = ${terminalId}`),
    ).rejects.toThrow(/check/);
    await expect(
      adminSql`update terminals set point_device_id = ${"x".repeat(65)} where id = ${terminalId}`,
    ).rejects.toThrow(/check/);
  });
});
