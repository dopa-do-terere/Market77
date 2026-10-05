import { requireOrgPage } from "@/auth/guard";
import { can } from "@/auth/permissions";
import { withOrg } from "@/db/tenant";
import { countOfflineTerminals } from "@/domain/agent";
import { listExpiryAlerts } from "@/domain/lots";
import { listMarkets } from "@/domain/markets";
import { countFiscalErrors, salesToday } from "@/domain/sale-queries";
import { listLowStock } from "@/domain/stock";
import { formatBRL } from "@/lib/money";
import { Alert, Badge, Card, PageHeader } from "@/ui";

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
    <main className="space-y-6">
      <PageHeader title="Painel" />
      {offline !== null && offline > 0 && (
        <Alert tone="warning">
          <a href={`/o/${orgId}/terminals`} className="font-semibold underline">
            {offline} totem(ns) offline
          </a>
        </Alert>
      )}
      {fiscalErrors !== null && fiscalErrors > 0 && (
        <Alert tone="danger">
          <a href={`/o/${orgId}/sales`} className="font-semibold underline">
            {fiscalErrors} nota(s) com erro
          </a>
        </Alert>
      )}
      {today && (
        <Card>
          <p className="text-sm font-medium text-muted">Vendas hoje</p>
          <p className="mt-1 text-3xl font-semibold">{formatBRL(today.totalCents)}</p>
          <p className="text-sm text-muted">{today.count} venda(s)</p>
        </Card>
      )}
      <Card title="Mercados">
        {markets.length === 0 && <p className="text-muted">Nenhum mercado cadastrado ainda.</p>}
        <ul className="-my-4 divide-y divide-border">
          {markets.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-2 py-3">
              <a href={`/o/${orgId}/markets/${m.id}`} className="font-medium text-link hover:underline">
                {m.name}
              </a>
              {m.low.length > 0 && <Badge tone="warning">{m.low.length} produto(s) com estoque baixo</Badge>}
              {m.expired > 0 && <Badge tone="danger">{m.expired} lote(s) vencido(s)</Badge>}
            </li>
          ))}
        </ul>
      </Card>
    </main>
  );
}
