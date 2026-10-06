import { formatBRL } from "@/lib/money";
import { Alert } from "./Alert";
import { Badge } from "./Badge";
import { Icon, type IconName } from "./Icon";
import { PageHeader } from "./PageHeader";

export type DashboardMarket = { id: string; name: string; address: string | null; lowCount: number; expired: number };
export type DashboardOverviewProps = {
  base: string;
  markets: DashboardMarket[];
  today: { totalCents: number; count: number } | null;
  offline: number | null;
  fiscalErrors: number | null;
  canCreateMarket: boolean;
};

function Metric({ label, value, note, icon, featured = false }: { label: string; value: string | number; note: string; icon: IconName; featured?: boolean }) {
  return (
    <section className={`rounded-2xl border p-5 shadow-sm ${featured ? "metric-featured" : "border-border bg-surface"}`}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-muted">{label}</h2>
        <span className={`flex size-9 items-center justify-center rounded-xl ${featured ? "bg-white/10 text-brand-200" : "bg-brand-100 text-brand-800 dark:bg-brand-950 dark:text-brand-200"}`}><Icon name={icon} /></span>
      </div>
      <p className="mt-4 text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
      <p className="mt-2 text-xs leading-relaxed text-muted">{note}</p>
    </section>
  );
}

export function DashboardOverview({ base, markets, today, offline, fiscalErrors, canCreateMarket }: DashboardOverviewProps) {
  const lowCount = markets.reduce((sum, market) => sum + market.lowCount, 0);
  const expired = markets.reduce((sum, market) => sum + market.expired, 0);
  const attention = markets.filter((market) => market.lowCount > 0 || market.expired > 0);
  return (
    <main className="space-y-8">
      <div className="dashboard-hero px-6 py-8 md:px-8 md:py-10">
        <p className="mb-4 flex items-center gap-2 text-xs font-semibold tracking-widest uppercase"><span className="size-2 rounded-full bg-brand-700 dark:bg-brand-300" /> Market77 · Visão geral</p>
        <PageHeader title="Sua operação, em foco." description="Cada mercado, cada venda, cada detalhe. Um olhar claro para o que acontece e o que precisa de você." actions={canCreateMarket ? <a href={`${base}/markets#new-market`} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#45260f] px-5 text-sm font-medium text-white shadow-sm hover:bg-[#60371b]"><Icon name="plus" /> Novo mercado</a> : undefined} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {today && <Metric label="Vendas hoje" value={formatBRL(today.totalCents)} note={`${today.count} ${today.count === 1 ? "venda paga" : "vendas pagas"} no dia local de cada mercado`} icon="sales" featured />}
        <Metric label="Mercados cadastrados" value={markets.length} note="Unidades da sua organização" icon="market" />
        <Metric label="Estoque baixo" value={lowCount} note="Produtos por mercado para conferir e repor" icon="product" />
        {today ? <Metric label="Ticket médio hoje" value={formatBRL(today.count ? Math.round(today.totalCents / today.count) : 0)} note={today.count ? "Valor médio por venda paga" : "Ainda não há vendas pagas hoje"} icon="payment" /> : <Metric label="Lotes vencidos" value={expired} note="Lotes que precisam de verificação" icon="warning" />}
      </div>
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-5">
            <div><h2 className="text-lg font-semibold tracking-tight">Seus mercados</h2><p className="mt-1 text-sm text-muted">Estoque e validade de cada unidade.</p></div>
            <a href={`${base}/markets`} className="inline-flex items-center gap-2 text-sm font-medium text-link hover:underline">Ver todos <Icon name="arrow" className="size-4" /></a>
          </div>
          {markets.length === 0 ? (
            <div className="flex flex-col items-center px-6 py-12 text-center">
              <span className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-subtle text-muted"><Icon name="market" className="size-7" /></span>
              <h3 className="font-semibold">Seu primeiro mercado começa aqui</h3>
              <p className="mt-2 max-w-xs text-sm leading-relaxed text-muted">Cadastre uma unidade para acompanhar estoque, validade e vendas.</p>
              {canCreateMarket && <a href={`${base}/markets#new-market`} className="mt-5 text-sm font-semibold text-link hover:underline">Cadastrar mercado →</a>}
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {markets.map((market) => (
                <li key={market.id}>
                  <a href={`${base}/markets/${market.id}`} className="group grid grid-cols-[44px_minmax(0,1fr)_16px] items-center gap-x-4 gap-y-3 px-6 py-5 sm:flex sm:flex-wrap transition-colors hover:bg-subtle">
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-100 text-brand-800 dark:bg-brand-950 dark:text-brand-200"><Icon name="market" /></span>
                    <div className="min-w-0 flex-1"><h3 className="break-words font-semibold group-hover:text-link">{market.name}</h3><p className="mt-1 break-words text-xs text-muted">{market.address || "Endereço não informado"}</p></div>
                    <div className="col-span-2 col-start-2 row-start-2 flex flex-wrap gap-2">
                      {market.lowCount > 0 && <Badge tone="warning">{market.lowCount} com estoque baixo</Badge>}
                      {market.expired > 0 && <Badge tone="danger">{market.expired} {market.expired === 1 ? "lote vencido" : "lotes vencidos"}</Badge>}
                      {market.lowCount === 0 && market.expired === 0 && <Badge tone="success">Sem alertas de estoque</Badge>}
                    </div>
                    <Icon name="arrow" className="col-start-3 row-start-1 size-4 shrink-0 text-muted group-hover:text-link" />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
        <div className="space-y-6">
          <section className="rounded-2xl border border-border bg-surface p-6 shadow-sm">
            <h2 className="flex items-center gap-2 text-base font-semibold"><Icon name="warning" className="text-link" /> Atenção à operação</h2>
            <div className="mt-5 space-y-3">
              {offline !== null && offline > 0 && <Alert tone="warning"><a href={`${base}/terminals`} className="font-medium underline">{offline} {offline === 1 ? "totem offline" : "totens offline"}</a></Alert>}
              {fiscalErrors !== null && fiscalErrors > 0 && <Alert tone="danger"><a href={`${base}/sales`} className="font-medium underline">{fiscalErrors} {fiscalErrors === 1 ? "nota com erro" : "notas com erro"}</a></Alert>}
              {attention.length > 0 && <a href={`${base}/markets`} className="block rounded-xl bg-subtle p-4 text-sm leading-relaxed hover:text-link"><strong className="block font-semibold">{attention.length} {attention.length === 1 ? "mercado para conferir" : "mercados para conferir"}</strong><span className="mt-1 block text-muted">{lowCount} {lowCount === 1 ? "produto com estoque baixo" : "produtos com estoque baixo"} e {expired} {expired === 1 ? "lote vencido" : "lotes vencidos"}.</span></a>}
              {attention.length === 0 && !offline && !fiscalErrors && <div className="rounded-xl bg-subtle p-4"><Icon name="check" className="mb-2 text-green-700 dark:text-green-300" /><p className="text-sm font-medium">Nenhum alerta disponível</p><p className="mt-1 text-xs leading-relaxed text-muted">Os indicadores que você pode consultar não têm pendências.</p></div>}
            </div>
          </section>
          <section className="rounded-2xl border border-border bg-surface p-6 shadow-sm">
            <h2 className="text-base font-semibold">Acesso rápido</h2>
            <div className="mt-3 divide-y divide-border">
              {[{ href: `${base}/products`, label: "Consultar produtos", icon: "product" as const }, { href: `${base}/markets`, label: "Gerenciar estoque", icon: "market" as const }, ...(today ? [{ href: `${base}/sales`, label: "Acompanhar vendas", icon: "sales" as const }] : [])].map((item) => <a key={item.href} href={item.href} className="flex min-h-12 items-center gap-3 py-3 text-sm text-muted hover:text-link"><Icon name={item.icon} className="size-4" /><span className="flex-1">{item.label}</span><Icon name="arrow" className="size-4" /></a>)}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
