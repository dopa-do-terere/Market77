import { notFound } from "next/navigation";
import { requireOrgPage } from "@/auth/guard";
import { can } from "@/auth/permissions";
import { withOrg } from "@/db/tenant";
import { getSaleDetail } from "@/domain/sale-queries";
import { FAILURE_LABEL, FISCAL_LABEL, METHOD_LABEL, PAYMENT_LABEL, STATUS_LABEL } from "@/lib/labels";
import { message } from "@/lib/messages";
import { formatBRL } from "@/lib/money";
import { reissueFiscalAction } from "./actions";

export default async function SaleDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string; saleId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { orgId, saleId } = await params;
  const { error } = await searchParams;
  const { role } = await requireOrgPage(orgId, "sale:read");
  const sale = await withOrg(orgId, (tx) => getSaleDetail(tx, saleId));
  if (!sale) notFound();
  const when = (d: Date) => d.toLocaleString("pt-BR", { timeZone: sale.timezone });
  return (
    <main>
      <h1>Venda</h1>
      {error && <p role="alert">{message(error)}</p>}
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
      {sale.customerCpfMasked && <p>CPF na nota: {sale.customerCpfMasked}</p>}
      {sale.fiscal && (
        <>
          <h2>Nota fiscal</h2>
          <p>
            {FISCAL_LABEL[sale.fiscal.status] ?? sale.fiscal.status}
            {sale.fiscal.number !== null && <>, número {sale.fiscal.number}</>}
            {sale.fiscal.accessKey && <>, chave {sale.fiscal.accessKey}</>}
            {sale.fiscal.danfeUrl && (
              <>
                {" "}
                ({sale.fiscal.danfeUrl.startsWith("https://") ? (
                  <a href={sale.fiscal.danfeUrl}>DANFE</a>
                ) : (
                  "DANFE indisponível"
                )})
              </>
            )}
          </p>
          {sale.fiscal.lastError && (
            <p role={sale.fiscal.status === "error" ? "alert" : undefined}>Última falha: {sale.fiscal.lastError}</p>
          )}
          {sale.fiscal.status === "error" && can(role, "market:write") && (
            <form action={reissueFiscalAction.bind(null, orgId, sale.id)}>
              <button type="submit">Reemitir</button>
            </form>
          )}
        </>
      )}
      <p>
        <a href={`/o/${orgId}/sales`}>Voltar às vendas</a>
      </p>
    </main>
  );
}
