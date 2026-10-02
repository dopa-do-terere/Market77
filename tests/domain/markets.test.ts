import { beforeEach, describe, expect, it } from "vitest";
import { withOrg } from "@/db/tenant";
import { createMarket, listMarkets } from "@/domain/markets";
import { AppError } from "@/lib/errors";
import { makeOrg, resetDb } from "../helpers";

beforeEach(resetDb);

describe("markets", () => {
  it("creates a market with defaults and lists only the tenant's markets", async () => {
    const a = await makeOrg("A");
    const b = await makeOrg("B");
    const m = await withOrg(a, (tx) => createMarket(tx, a, { name: "Loja Bloco 1" }));
    await withOrg(b, (tx) => createMarket(tx, b, { name: "Loja B" }));
    expect(m.timezone).toBe("America/Sao_Paulo");
    expect((await withOrg(a, (tx) => listMarkets(tx))).map((x) => x.name)).toEqual(["Loja Bloco 1"]);
  });

  it("strips punctuation from the CNPJ and rejects wrong lengths", async () => {
    const a = await makeOrg("A");
    const m = await withOrg(a, (tx) =>
      createMarket(tx, a, { name: "Loja", cnpj: "12.345.678/0001-95" }),
    );
    expect(m.cnpj).toBe("12345678000195");
    await expect(withOrg(a, (tx) => createMarket(tx, a, { name: "Loja", cnpj: "123" }))).rejects.toBeInstanceOf(AppError);
  });

  it("rejects short names and unknown time zones", async () => {
    const a = await makeOrg("A");
    await expect(withOrg(a, (tx) => createMarket(tx, a, { name: "x" }))).rejects.toBeInstanceOf(AppError);
    await expect(
      withOrg(a, (tx) => createMarket(tx, a, { name: "Loja", timezone: "Marte/Olympus" })),
    ).rejects.toBeInstanceOf(AppError);
  });
});
