import { adminSql } from "@/db/client";
import { withOrg } from "@/db/tenant";
import { refreshSale } from "@/domain/refresh";
import { getProvider } from "./registry";

/**
 * Cross-tenant sweep of sales still awaiting payment (webhook lost and the totem gone).
 * Meant to be called by a cron through POST /api/internal/reconcile (scheduled in phase 3).
 * ponytail: uses the global provider; resolve it from payments.provider once adapters are per organization.
 */
export async function reconcilePending(now: Date = new Date(), limit = 100): Promise<number> {
  const rows = await adminSql`
    select id, org_id, market_id, terminal_id from sales
    where status = 'awaiting_payment' order by created_at limit ${limit}`;
  const provider = getProvider();
  let visited = 0;
  for (const r of rows) {
    try {
      await withOrg(r.org_id as string, (tx) =>
        refreshSale(
          tx,
          { terminalId: r.terminal_id as string, marketId: r.market_id as string },
          r.id as string,
          provider,
          now,
        ),
      );
      visited++;
    } catch (e) {
      console.error("reconcile failed for sale", r.id, e); // one bad sale must not stop the sweep
    }
  }
  return visited;
}
