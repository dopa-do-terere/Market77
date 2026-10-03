import { requireOrgPage } from "@/auth/guard";
import { withOrg } from "@/db/tenant";
import { listRecentSales } from "@/domain/sale-queries";
import { STATUS_LABEL } from "@/lib/labels";
import { formatBRL } from "@/lib/money";

export default async function SalesPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  await requireOrgPage(orgId, "sale:read");
  const sales = await withOrg(orgId, (tx) => listRecentSales(tx));
  return (
    <main>
      <h1>Vendas</h1>
      {sales.length === 0 && <p>Nenhuma venda ainda.</p>}
      <table>
        <thead>
          <tr><th>Data</th><th>Mercado</th><th>Itens</th><th>Total</th><th>Situação</th></tr>
        </thead>
        <tbody>
          {sales.map((s) => (
            <tr key={s.id}>
              <td>
                <a href={`/o/${orgId}/sales/${s.id}`}>
                  {s.createdAt.toLocaleString("pt-BR", { timeZone: s.timezone })}
                </a>
              </td>
              <td>{s.marketName}</td>
              <td>{s.itemCount}</td>
              <td>{formatBRL(s.totalCents)}</td>
              <td>{STATUS_LABEL[s.status] ?? s.status}{s.needsAttention && <b> (requer atenção)</b>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
