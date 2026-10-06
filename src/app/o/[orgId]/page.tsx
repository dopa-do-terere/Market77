import { requireOrgPage } from "@/auth/guard";
import { can } from "@/auth/permissions";
import { withOrg } from "@/db/tenant";
import { countOfflineTerminals } from "@/domain/agent";
import { listExpiryAlerts } from "@/domain/lots";
import { listMarkets } from "@/domain/markets";
import { countFiscalErrors, salesToday } from "@/domain/sale-queries";
import { listLowStock } from "@/domain/stock";
import { DashboardOverview } from "@/ui/DashboardOverview";

export default async function Dashboard({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const { role } = await requireOrgPage(orgId, "stock:read");
  const { markets, today, offline, fiscalErrors } = await withOrg(orgId, async (tx) => ({
    markets: await Promise.all(
      (await listMarkets(tx)).map(async (m) => ({
        ...m,
        low: await listLowStock(tx, m.id),
        expired: (await listExpiryAlerts(tx, m.id, new Date())).filter((a) => a.status === "expired").length,
      })),
    ),
    today: can(role, "sale:read") ? await salesToday(tx) : null,
    offline: can(role, "terminal:write") ? await countOfflineTerminals(tx, new Date()) : null,
    fiscalErrors: can(role, "sale:read") ? await countFiscalErrors(tx) : null,
  }));
  return (
    <DashboardOverview
      base={`/o/${orgId}`}
      markets={markets.map((market) => ({ ...market, lowCount: market.low.length }))}
      today={today}
      offline={offline}
      fiscalErrors={fiscalErrors}
      canCreateMarket={can(role, "market:write")}
    />
  );
}
