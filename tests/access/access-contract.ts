import { describe, expect, it } from "vitest";
import type { AccessPerson, AccessProvider, AccessSourceRef } from "@/access/provider";

export type AccessHarness = {
  provider: AccessProvider;
  /** Makes the reader report exactly these people. */
  setPeople(source: AccessSourceRef, people: AccessPerson[]): void;
};

/** Every access adapter must pass this suite (the real one runs it against its sandbox). */
export function accessProviderContract(name: string, make: () => AccessHarness) {
  describe(`access provider contract: ${name}`, () => {
    const a: AccessSourceRef = { id: "source-a", marketId: "market-1", name: "Porta A" };
    const b: AccessSourceRef = { id: "source-b", marketId: "market-1", name: "Porta B" };

    it("lists the people the reader reports, as plain id and name strings", async () => {
      const h = make();
      h.setPeople(a, [
        { externalId: "u1", name: "Ana" },
        { externalId: "u2", name: "Bia" },
      ]);
      const people = await h.provider.listPeople(a);
      expect(people).toEqual([
        { externalId: "u1", name: "Ana" },
        { externalId: "u2", name: "Bia" },
      ]);
    });

    it("returns an empty list for a reader with no people", async () => {
      expect(await make().provider.listPeople(a)).toEqual([]);
    });

    it("keeps the lists of different readers apart", async () => {
      const h = make();
      h.setPeople(a, [{ externalId: "u1", name: "Ana" }]);
      h.setPeople(b, [{ externalId: "u9", name: "Zé" }]);
      expect((await h.provider.listPeople(a)).map((p) => p.externalId)).toEqual(["u1"]);
      expect((await h.provider.listPeople(b)).map((p) => p.externalId)).toEqual(["u9"]);
    });
  });
}
