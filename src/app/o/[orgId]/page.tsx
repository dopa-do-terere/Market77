import { requireOrgPage } from "@/auth/guard";
import { can } from "@/auth/permissions";
import { withOrg } from "@/db/tenant";
import { countOfflineTerminals } from "@/domain/agent";
import { listExpiryAlerts } from "@/domain/lots";
import { listMarkets } from "@/domain/markets";
import { salesToday } from "@/domain/sale-queries";
import { listLowStock } from "@/domain/stock";
import { formatBRL } from "@/lib/money";

export default async function Dashboard({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const { role } = await requireOrgPage(orgId, "stock:read");
  const { markets, today, offline } = await withOrg(orgId, async (tx) => ({
    markets: await Promise.all(
      (await listMarkets(tx)).map(async (m) => ({
        ...m,
        low: await listLowStock(tx, m.id),
        expired: (await listExpiryAlerts(tx, m.id, new Date())).filter((a) => a.status === "expired").length,
      })),
    ),
    today: can(role, "sale:read") ? await salesToday(tx) : null,
    offline: can(role, "terminal:write") ? await countOfflineTerminals(tx, new Date()) : null,
  }));
  return (
    <main>
      <h1>Painel</h1>
      {offline !== null && offline > 0 && (
        <p role="alert">
          <a href={`/o/${orgId}/terminals`}>
            <strong>{offline} totem(ns) offline</strong>
          </a>
        </p>
      )}
      {today && (
        <p>
          Vendas hoje: <strong>{formatBRL(today.totalCents)}</strong> ({today.count})
        </p>
      )}
      {markets.length === 0 && <p>Nenhum mercado cadastrado ainda.</p>}
      <ul>
        {markets.map((m) => (
          <li key={m.id}>
            <a href={`/o/${orgId}/markets/${m.id}`}>{m.name}</a>
            {m.low.length > 0 && <strong> ({m.low.length} produto(s) com estoque baixo)</strong>}
            {m.expired > 0 && <strong> ({m.expired} lote(s) vencido(s))</strong>}
          </li>
        ))}
      </ul>
    </main>
  );
}
