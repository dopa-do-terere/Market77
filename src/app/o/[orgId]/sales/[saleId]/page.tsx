import { notFound } from "next/navigation";
import { requireOrgPage } from "@/auth/guard";
import { can } from "@/auth/permissions";
import { withOrg } from "@/db/tenant";
import { getSaleDetail } from "@/domain/sale-queries";
import { FAILURE_LABEL, FISCAL_LABEL, METHOD_LABEL, PAYMENT_LABEL, STATUS_LABEL } from "@/lib/labels";
import { message } from "@/lib/messages";
import { formatBRL } from "@/lib/money";
import { Alert, Badge, Button, Card, FISCAL_TONE, PAYMENT_TONE, PageHeader, SALE_TONE } from "@/ui";
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
    <main className="space-y-6">
      <PageHeader
        icon="sales"
        title="Detalhes da venda"
        description={`${sale.marketName}, ${when(sale.createdAt)}`}
        actions={<Badge tone={SALE_TONE[sale.status] ?? "neutral"}>{STATUS_LABEL[sale.status] ?? sale.status}</Badge>}
      />
      {error && <Alert tone="danger">{message(error)}</Alert>}
      <Card className="metric-featured">
        <p className="text-sm font-medium text-muted">Total</p>
        <p className="mt-1 text-3xl font-semibold">{formatBRL(sale.totalCents)}</p>
        {sale.paidAt && <p className="text-sm text-muted">Paga em {when(sale.paidAt)}</p>}
        {sale.customerCpfMasked && <p className="mt-2 text-sm">CPF na nota: {sale.customerCpfMasked}</p>}
      </Card>
      <Card icon="product" title="Itens da compra">
        <ul className="-my-4 divide-y divide-border">
          {sale.items.map((i, idx) => (
            <li key={idx} className="flex flex-wrap items-center justify-between gap-3 py-4">
              <span className="font-medium">{i.quantity} × {i.productName}</span><span className="text-sm text-muted">{formatBRL(i.unitPriceCents)} por unidade</span>
            </li>
          ))}
        </ul>
      </Card>
      <Card icon="payment" title="Pagamentos">
        {sale.payments.length === 0 && <p className="text-muted">Nenhum pagamento iniciado.</p>}
        <ul className="-my-4 divide-y divide-border">
          {sale.payments.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-2 py-3">
              <span className="font-medium">{METHOD_LABEL[p.method] ?? p.method}</span>
              <Badge tone={PAYMENT_TONE[p.status] ?? "neutral"}>{PAYMENT_LABEL[p.status] ?? p.status}</Badge>
              {p.failureReason && <Badge tone="danger">{FAILURE_LABEL[p.failureReason] ?? p.failureReason}</Badge>}
              <span className="text-muted">
                esperado {formatBRL(p.amountCents)}
                {p.paidAmountCents !== null && <>, recebido {formatBRL(p.paidAmountCents)}</>}
              </span>
              {p.status === "failed" && !p.failureReason && (
                <Badge tone="warning">requer atenção: verifique com o provedor</Badge>
              )}
            </li>
          ))}
        </ul>
      </Card>
      {sale.fiscal && (
        <Card icon="sales" title="Nota fiscal">
          <div className="space-y-2">
            <p className="flex flex-wrap items-center gap-2">
              <Badge tone={FISCAL_TONE[sale.fiscal.status] ?? "neutral"}>
                {FISCAL_LABEL[sale.fiscal.status] ?? sale.fiscal.status}
              </Badge>
              {sale.fiscal.number !== null && <>número {sale.fiscal.number}</>}
              {sale.fiscal.danfeUrl &&
                (sale.fiscal.danfeUrl.startsWith("https://") ? (
                  <a href={sale.fiscal.danfeUrl} className="font-medium text-link hover:underline">
                    DANFE
                  </a>
                ) : (
                  <span className="text-muted">DANFE indisponível</span>
                ))}
            </p>
            {sale.fiscal.accessKey && <p className="break-all text-sm text-muted">Chave {sale.fiscal.accessKey}</p>}
            {sale.fiscal.lastError && (
              <Alert tone={sale.fiscal.status === "error" ? "danger" : "info"}>
                Última falha: {sale.fiscal.lastError}
              </Alert>
            )}
            {sale.fiscal.status === "error" && can(role, "market:write") && (
              <form action={reissueFiscalAction.bind(null, orgId, sale.id)}>
                <Button type="submit">Reemitir</Button>
              </form>
            )}
          </div>
        </Card>
      )}
      <p>
        <a href={`/o/${orgId}/sales`} className="font-medium text-link hover:underline">
          Voltar às vendas
        </a>
      </p>
    </main>
  );
}
