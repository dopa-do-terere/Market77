import { AccessUnavailable, type AccessPerson, type AccessProvider, type AccessSourceRef } from "./provider";

export type FakeAccessMode = "ok" | "down";

// ponytail: state lives in memory, for dev and tests only. A real adapter asks its reader instead.
const g = globalThis as unknown as {
  __m77fakeAccess?: { mode: FakeAccessMode; people: Map<string, AccessPerson[]> };
};
const state = (g.__m77fakeAccess ??= { mode: "ok", people: new Map() });

function guard(): void {
  if (process.env.NODE_ENV === "production") throw new Error("fake access provider is disabled in production");
}

export function setFakePeople(sourceId: string, people: AccessPerson[]): void {
  guard();
  state.people.set(sourceId, people.map((p) => ({ ...p })));
}

export function setFakeAccessMode(mode: FakeAccessMode): void {
  guard();
  state.mode = mode;
}

/** Tests: forget every list and go back to "ok". */
export function resetFakeAccess(): void {
  guard();
  state.mode = "ok";
  state.people.clear();
}

export const fakeAccessProvider: AccessProvider = {
  name: "fake",

  async listPeople(source: AccessSourceRef): Promise<AccessPerson[]> {
    guard();
    if (state.mode === "down") throw new AccessUnavailable();
    return (state.people.get(source.id) ?? []).map((p: AccessPerson) => ({ ...p }));
  },
};
