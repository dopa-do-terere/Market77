import { requireOrgPage } from "@/auth/guard";
import { withOrg } from "@/db/tenant";
import { listRecentSales } from "@/domain/sale-queries";
import { STATUS_LABEL } from "@/lib/labels";
import { formatBRL } from "@/lib/money";
import { Badge, Card, PageHeader, SALE_TONE, Table } from "@/ui";

export default async function SalesPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  await requireOrgPage(orgId, "sale:read");
  const sales = await withOrg(orgId, (tx) => listRecentSales(tx));
  return (
    <main className="space-y-6">
      <PageHeader title="Vendas" />
      {sales.length === 0 && <Card><p className="text-muted">Nenhuma venda ainda.</p></Card>}
      {sales.length > 0 && (
        <Table>
          <thead>
            <tr><th>Data</th><th>Mercado</th><th>Itens</th><th>Total</th><th>Situação</th></tr>
          </thead>
          <tbody>
            {sales.map((s) => (
              <tr key={s.id}>
                <td>
                  <a href={`/o/${orgId}/sales/${s.id}`} className="font-medium text-link hover:underline">
                    {s.createdAt.toLocaleString("pt-BR", { timeZone: s.timezone })}
                  </a>
                </td>
                <td>{s.marketName}</td>
                <td>{s.itemCount}</td>
                <td>{formatBRL(s.totalCents)}</td>
                <td>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge tone={SALE_TONE[s.status] ?? "neutral"}>{STATUS_LABEL[s.status] ?? s.status}</Badge>
                    {s.needsAttention && <Badge tone="warning">requer atenção</Badge>}
                    {s.fiscalError && <Badge tone="danger">nota com erro</Badge>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </main>
  );}
