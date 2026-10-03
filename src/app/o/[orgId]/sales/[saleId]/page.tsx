import { notFound } from "next/navigation";
import { requireOrgPage } from "@/auth/guard";
import { withOrg } from "@/db/tenant";
import { getSaleDetail } from "@/domain/sale-queries";
import { FAILURE_LABEL, METHOD_LABEL, PAYMENT_LABEL, STATUS_LABEL } from "@/lib/labels";
import { formatBRL } from "@/lib/money";

export default async function SaleDetailPage({ params }: { params: Promise<{ orgId: string; saleId: string }> }) {
  const { orgId, saleId } = await params;
  await requireOrgPage(orgId, "sale:read");
  const sale = await withOrg(orgId, (tx) => getSaleDetail(tx, saleId));
  if (!sale) notFound();
  const when = (d: Date) => d.toLocaleString("pt-BR", { timeZone: sale.timezone });
  return (
    <main>
      <h1>Venda</h1>
      <p>
        {sale.marketName}, {when(sale.createdAt)}: {STATUS_LABEL[sale.status] ?? sale.status},{" "}
        {formatBRL(sale.totalCents)}
        {sale.paidAt && <> (paga em {when(sale.paidAt)})</>}
      </p>
      <h2>Itens</h2>
      <ul>
        {sale.items.map((i, idx) => (
          <li key={idx}>
            {i.quantity} x {i.productName} a {formatBRL(i.unitPriceCents)}
          </li>
        ))}
      </ul>
      <h2>Pagamentos</h2>
      {sale.payments.length === 0 && <p>Nenhum pagamento iniciado.</p>}
      <ul>
        {sale.payments.map((p) => (
          <li key={p.id}>
            {METHOD_LABEL[p.method] ?? p.method}, {PAYMENT_LABEL[p.status] ?? p.status}
            {p.failureReason && <> ({FAILURE_LABEL[p.failureReason] ?? p.failureReason})</>}: esperado{" "}
            {formatBRL(p.amountCents)}
            {p.paidAmountCents !== null && <>, recebido {formatBRL(p.paidAmountCents)}</>}
            {p.status === "failed" && !p.failureReason && (
              <strong> (requer atenção: verifique com o provedor)</strong>
            )}
          </li>
        ))}
      </ul>
      <p>
        <a href={`/o/${orgId}/sales`}>Voltar às vendas</a>
      </p>
    </main>
  );
}
