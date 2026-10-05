import { beforeEach, describe, expect, it, vi } from "vitest";
import { adminSql } from "@/db/client";
import { withOrg } from "@/db/tenant";
import {
  mercadoPagoStatus,
  readMercadoPagoCredentials,
  readOwnMercadoPagoCredentials,
  removeMercadoPagoCredentials,
  saveMercadoPagoCredentials,
} from "@/domain/credentials";
import { createTerminal, listTerminals, setTerminalDevice } from "@/domain/terminals";
import { AppError } from "@/lib/errors";
import { makeOrg, resetDb, seedStore } from "../helpers";

beforeEach(resetDb);

const TOKEN = "APP_USR-1234567890-abcdef";
const SECRET = "whsec-super-secreto";
const save = (orgId: string, raw: unknown = { accessToken: TOKEN, webhookSecret: SECRET }) =>
  withOrg(orgId, (tx) => saveMercadoPagoCredentials(tx, orgId, raw));

describe("Mercado Pago credentials", () => {
  it("stores both secrets encrypted and reads them back", async () => {
    const orgId = await makeOrg("A");
    await save(orgId);
    const [row] = await adminSql`select access_token_enc, webhook_secret_enc from provider_credentials`;
    expect(JSON.stringify(row)).not.toContain(TOKEN);
    expect(JSON.stringify(row)).not.toContain(SECRET);
    expect(await withOrg(orgId, (tx) => readOwnMercadoPagoCredentials(tx))).toEqual({
      accessToken: TOKEN,
      webhookSecret: SECRET,
    });
    expect(await readMercadoPagoCredentials(orgId)).toEqual({ accessToken: TOKEN, webhookSecret: SECRET });
  });

  it("shows only the state, never the secrets", async () => {
    const orgId = await makeOrg("A");
    expect(await withOrg(orgId, (tx) => mercadoPagoStatus(tx))).toEqual({
      configured: false,
      last4: null,
      updatedAt: null,
    });
    await save(orgId);
    const status = await withOrg(orgId, (tx) => mercadoPagoStatus(tx));
    expect(status.configured).toBe(true);
    expect(status.last4).toBe("cdef");
    expect(JSON.stringify(status)).not.toContain(SECRET);
    expect(JSON.stringify(status)).not.toContain(TOKEN);
  });

  it("replaces the previous credentials and removes them", async () => {
    const orgId = await makeOrg("A");
    await save(orgId);
    await save(orgId, { accessToken: "APP_USR-novo-token-9999", webhookSecret: "outro-segredo" });
    expect((await readMercadoPagoCredentials(orgId))?.accessToken).toBe("APP_USR-novo-token-9999");
    expect(await adminSql`select 1 from provider_credentials`).toHaveLength(1);
    await withOrg(orgId, (tx) => removeMercadoPagoCredentials(tx));
    expect(await readMercadoPagoCredentials(orgId)).toBeNull();
  });

  it("never lets one organization read or replace another's credentials", async () => {
    const a = await makeOrg("A");
    const b = await makeOrg("B");
    await save(a);
    expect(await withOrg(b, (tx) => readOwnMercadoPagoCredentials(tx))).toBeNull();
    expect(await readMercadoPagoCredentials(b)).toBeNull();
    await withOrg(b, (tx) => removeMercadoPagoCredentials(tx));
    expect(await readMercadoPagoCredentials(a)).not.toBeNull();
  });

  it("rejects malformed input without echoing it", async () => {
    const orgId = await makeOrg("A");
    for (const raw of [
      {},
      { accessToken: "curto", webhookSecret: SECRET },
      { accessToken: TOKEN, webhookSecret: "x" },
      { accessToken: "token com espaco 12345", webhookSecret: SECRET },
      { accessToken: TOKEN, webhookSecret: "segredo\u0000nulo" },
    ]) {
      const err = await save(orgId, raw).catch((e) => e);
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe("invalid_input");
      expect((err as AppError).message).not.toContain("token com espaco");
    }
  });

  it("fails clearly when the server has no encryption key", async () => {
    const orgId = await makeOrg("A");
    vi.stubEnv("CREDENTIALS_KEY", "");
    const err = await save(orgId).catch((e) => e);
    expect((err as AppError).code).toBe("credentials_key_missing");
    vi.unstubAllEnvs();
  });
});

describe("Point device of a terminal", () => {
  it("is set, listed and cleared", async () => {
    const orgId = await makeOrg("A");
    const { terminalId } = await seedStore(orgId);
    await withOrg(orgId, (tx) => setTerminalDevice(tx, terminalId, { pointDeviceId: " NEWLAND_N950__X1 " }));
    expect((await withOrg(orgId, (tx) => listTerminals(tx)))[0].pointDeviceId).toBe("NEWLAND_N950__X1");
    await withOrg(orgId, (tx) => setTerminalDevice(tx, terminalId, {}));
    expect((await withOrg(orgId, (tx) => listTerminals(tx)))[0].pointDeviceId).toBeNull();
  });

  it("can be given when the terminal is created", async () => {
    const orgId = await makeOrg("A");
    const { marketId } = await seedStore(orgId);
    await withOrg(orgId, (tx) =>
      createTerminal(tx, orgId, { marketId, name: "Totem 2", pointDeviceId: "PAX_A910__ABC" }),
    );
    const t = (await withOrg(orgId, (tx) => listTerminals(tx))).find((x) => x.name === "Totem 2");
    expect(t?.pointDeviceId).toBe("PAX_A910__ABC");
  });

  it("rejects an invalid id and a terminal of another organization", async () => {
    const a = await makeOrg("A");
    const b = await makeOrg("B");
    const { terminalId } = await seedStore(a);
    const bad = (raw: unknown, org = a) => withOrg(org, (tx) => setTerminalDevice(tx, terminalId, raw));
    await expect(bad({ pointDeviceId: "com espaco" })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(bad({ pointDeviceId: "x".repeat(65) })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(bad({ pointDeviceId: "OK_ID_1" }, b)).rejects.toMatchObject({ code: "not_found" });
  });
});
