import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as modeRoute } from "@/app/api/dev/fake-fiscal/mode/route";
import { fakeFiscalProvider, resetFakeFiscal, setFakeFiscalMode } from "@/fiscal/fake-fiscal";
import { FiscalRejected, FiscalUnavailable } from "@/fiscal/provider";
import { getFiscalProvider } from "@/fiscal/registry";
import { AppError } from "@/lib/errors";
import { fiscalProviderContract, samplePayload } from "./fiscal-contract";

beforeEach(() => resetFakeFiscal());
afterEach(() => vi.unstubAllEnvs());

fiscalProviderContract("fake", () => {
  resetFakeFiscal();
  return fakeFiscalProvider;
});

describe("fake fiscal modes", () => {
  it("down: issuing and looking up both fail as unavailable", async () => {
    setFakeFiscalMode("down");
    await expect(fakeFiscalProvider.issueNfce("r", samplePayload)).rejects.toBeInstanceOf(FiscalUnavailable);
    await expect(fakeFiscalProvider.getByRef("r")).rejects.toBeInstanceOf(FiscalUnavailable);
  });

  it("reject: issuing fails with a typed rejection", async () => {
    setFakeFiscalMode("reject");
    const e = await fakeFiscalProvider.issueNfce("r", samplePayload).catch((x) => x);
    expect(e).toBeInstanceOf(FiscalRejected);
    expect((e as FiscalRejected).code).toBe("fake_rejected");
  });

  it("lost: the note is issued but the answer is lost, and a lookup finds it", async () => {
    setFakeFiscalMode("lost");
    await expect(fakeFiscalProvider.issueNfce("r", samplePayload)).rejects.toBeInstanceOf(FiscalUnavailable);
    setFakeFiscalMode("ok");
    const found = await fakeFiscalProvider.getByRef("r");
    expect(found?.number).toBe(1);
    expect(await fakeFiscalProvider.issueNfce("r", samplePayload)).toEqual(found);
  });

  it("refuses to run in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(fakeFiscalProvider.issueNfce("r", samplePayload)).rejects.toThrow(/production/);
  });
});

describe("registry", () => {
  it("resolves the fake provider and turns an unknown name into provider_unavailable", () => {
    expect(getFiscalProvider("fake")).toBe(fakeFiscalProvider);
    for (const name of ["nope", "constructor", "__proto__"]) {
      expect(() => getFiscalProvider(name)).toThrow(AppError);
    }
  });
});

describe("mode route", () => {
  const call = (body: unknown, raw?: string) =>
    modeRoute(new Request("http://m77.test/api/dev/fake-fiscal/mode", { method: "POST", body: raw ?? JSON.stringify(body) }));

  it("switches the mode, rejects bad input and is a 404 in production", async () => {
    const ok = await call({ mode: "down" });
    expect([ok.status, await ok.json()]).toEqual([200, { mode: "down" }]);
    await expect(fakeFiscalProvider.getByRef("r")).rejects.toBeInstanceOf(FiscalUnavailable);
    expect((await call({ mode: "boom" })).status).toBe(400);
    expect((await call(undefined, "{")).status).toBe(400);
    vi.stubEnv("NODE_ENV", "production");
    expect((await call({ mode: "ok" })).status).toBe(404);
  });
});
