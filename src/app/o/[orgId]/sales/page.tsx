import { requireOrgPage } from "@/auth/guard";
import { withOrg } from "@/db/tenant";
import { listRecentSales } from "@/domain/sale-queries";
import { STATUS_LABEL } from "@/lib/labels";
import { formatBRL } from "@/lib/money";
import { Badge, Card, EmptyState, StatCard, PageHeader, SALE_TONE, Table } from "@/ui";

export default async function SalesPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  await requireOrgPage(orgId, "sale:read");
  const sales = await withOrg(orgId, (tx) => listRecentSales(tx));
  return (
    <main className="space-y-6">
      <PageHeader icon="sales" title="Vendas" description="Acompanhe os pedidos, os pagamentos e as pendências fiscais." />
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Vendas listadas" value={sales.length} note="Até 50 vendas mais recentes" icon="sales" featured />
        <StatCard label="Pagas nesta lista" value={sales.filter((s) => s.status === "paid").length} note="Pedidos com pagamento confirmado" icon="check" />
        <StatCard label="Precisam de atenção" value={sales.filter((s) => s.needsAttention || s.fiscalError).length} note="Pendências de pagamento ou nota fiscal" icon="warning" />
      </div>
      {sales.length === 0 && <Card><EmptyState icon="sales" title="As próximas vendas aparecem aqui" description="Assim que houver pedidos nos totens, você poderá acompanhar os detalhes e pagamentos." /></Card>}
      {sales.length > 0 && (
        <Table title="Vendas recentes" description="Abra uma venda para consultar os itens, o pagamento e a nota fiscal.">
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
                <td className="whitespace-nowrap font-semibold tabular-nums">{formatBRL(s.totalCents)}</td>
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
  );
}
