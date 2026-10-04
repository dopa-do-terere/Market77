import { beforeEach, describe, expect, it } from "vitest";
import { withOrg } from "@/db/tenant";
import { createTerminal } from "@/domain/terminals";
import { scanHandler } from "@/pdv/http";
import { addLot, makeOrg, resetDb, seedSellable, seedStore, track } from "../helpers";

beforeEach(resetDb);

const BARCODE = "7891000100103";

describe("scanning an expired product over HTTP", () => {
  it("answers 404 with a Portuguese message and sells again once a valid lot exists", async () => {
    const orgId = await makeOrg("A");
    const store = await seedStore(orgId);
    const item = await seedSellable(orgId, store.marketId, { barcode: BARCODE });
    await track(item.marketProductId);
    await addLot(orgId, item.marketProductId, "2020-01-01", 3);
    const { token } = await withOrg(orgId, (tx) =>
      createTerminal(tx, orgId, { marketId: store.marketId, name: "Totem 1" }),
    );
    const scan = () =>
      scanHandler(
        new Request("http://m77.test/api/pdv/sales/items", {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ barcode: BARCODE }),
        }),
      );
    const blocked = await scan();
    expect([blocked.status, await blocked.json()]).toEqual([
      404,
      { error: "product_expired", message: "Produto vencido. Procure o atendimento." },
    ]);
    await addLot(orgId, item.marketProductId, "2999-01-01", 1);
    expect((await scan()).status).toBe(200);
  });
});
