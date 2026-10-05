import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as modeRoute } from "@/app/api/dev/fake-access/mode/route";
import { POST as peopleRoute } from "@/app/api/dev/fake-access/people/route";
import { fakeAccessProvider, resetFakeAccess, setFakeAccessMode, setFakePeople } from "@/access/fake-access";
import { AccessUnavailable } from "@/access/provider";
import { getAccessProvider } from "@/access/registry";
import { AppError } from "@/lib/errors";
import { accessProviderContract } from "./access-contract";

beforeEach(() => resetFakeAccess());
afterEach(() => vi.unstubAllEnvs());

accessProviderContract("fake", () => {
  resetFakeAccess();
  return { provider: fakeAccessProvider, setPeople: (s, p) => setFakePeople(s.id, p) };
});

const SRC = { id: "s1", marketId: "m1", name: "Porta" };

describe("fake access modes", () => {
  it("down: listing fails as unavailable", async () => {
    setFakeAccessMode("down");
    await expect(fakeAccessProvider.listPeople(SRC)).rejects.toBeInstanceOf(AccessUnavailable);
    setFakeAccessMode("ok");
    await expect(fakeAccessProvider.listPeople(SRC)).resolves.toEqual([]);
  });

  it("hands out copies, so callers cannot change the stored list", async () => {
    setFakePeople("s1", [{ externalId: "u1", name: "Ana" }]);
    (await fakeAccessProvider.listPeople(SRC))[0].name = "Mudou";
    expect((await fakeAccessProvider.listPeople(SRC))[0].name).toBe("Ana");
  });

  it("refuses to run in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(fakeAccessProvider.listPeople(SRC)).rejects.toThrow(/production/);
  });
});

describe("registry", () => {
  it("resolves the fake provider and turns an unknown name into provider_unavailable", () => {
    expect(getAccessProvider("fake")).toBe(fakeAccessProvider);
    for (const name of ["nope", "constructor", "__proto__"]) {
      expect(() => getAccessProvider(name)).toThrow(AppError);
    }
  });
});

describe("dev routes", () => {
  const post = (route: (r: Request) => Promise<Response>, body: unknown, raw?: string) =>
    route(new Request("http://m77.test/x", { method: "POST", body: raw ?? JSON.stringify(body) }));

  it("sets the people of a reader and rejects bad input", async () => {
    const ok = await post(peopleRoute, { sourceId: "s1", people: [{ externalId: "u1", name: "Ana" }] });
    expect([ok.status, await ok.json()]).toEqual([200, { count: 1 }]);
    expect(await fakeAccessProvider.listPeople(SRC)).toEqual([{ externalId: "u1", name: "Ana" }]);
    expect((await post(peopleRoute, { sourceId: "s1", people: [{ externalId: "", name: "x" }] })).status).toBe(400);
    expect((await post(peopleRoute, { people: [] })).status).toBe(400);
    expect((await post(peopleRoute, undefined, "{")).status).toBe(400);
  });

  it("switches the mode, rejects bad input and is a 404 in production", async () => {
    const ok = await post(modeRoute, { mode: "down" });
    expect([ok.status, await ok.json()]).toEqual([200, { mode: "down" }]);
    await expect(fakeAccessProvider.listPeople(SRC)).rejects.toBeInstanceOf(AccessUnavailable);
    expect((await post(modeRoute, { mode: "boom" })).status).toBe(400);
    expect((await post(modeRoute, undefined, "{")).status).toBe(400);
    vi.stubEnv("NODE_ENV", "production");
    expect((await post(modeRoute, { mode: "ok" })).status).toBe(404);
    expect((await post(peopleRoute, { sourceId: "s1", people: [] })).status).toBe(404);
  });
});
