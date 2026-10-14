import { requireOrgPage } from "@/auth/guard";
import { can } from "@/auth/permissions";
import { withOrg } from "@/db/tenant";
import { listMarkets } from "@/domain/markets";
import { message } from "@/lib/messages";
import { Alert, Button, ButtonLink, Card, EmptyState, Icon, StatCard, Field, Input, PageHeader } from "@/ui";
import { createMarketAction } from "./actions";

export default async function MarketsPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { orgId } = await params;
  const { error } = await searchParams;
  const { role } = await requireOrgPage(orgId, "catalog:read");
  const markets = await withOrg(orgId, (tx) => listMarkets(tx));
  return (
    <main className="space-y-6">
      <PageHeader icon="market" title="Mercados" description="Gerencie suas unidades e acompanhe a operação de cada mercado." actions={can(role, "market:write") ? <ButtonLink href="#new-market"><Icon name="plus" /> Novo mercado</ButtonLink> : undefined} />
      {error && <Alert tone="danger">{message(error)}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard label="Seus mercados" value={markets.length} note="Unidades cadastradas na organização" icon="market" featured />
        <StatCard label="Emissão fiscal habilitada" value={markets.filter((m) => m.nfceEnabled).length} note="Mercados configurados para emitir NFC-e" icon="sales" />
      </div>
      {markets.length === 0 ? (
        <Card><EmptyState icon="market" title="Dê um endereço à sua operação" description="Cadastre seu primeiro mercado para começar a organizar os produtos e o estoque." /></Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {markets.map((m) => (
            <Card key={m.id}>
              <div className="flex items-start gap-4">
                <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-brand-100 text-brand-800 dark:bg-brand-950 dark:text-brand-200"><Icon name="market" className="size-6" /></span>
                <div className="min-w-0"><h2 className="break-words text-lg font-semibold">{m.name}</h2><p className="mt-1 text-sm text-muted">{m.address || "Endereço não informado"}</p></div>
              </div>
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                <span className="text-xs text-muted">{m.nfceEnabled ? "Emissão de NFC-e habilitada" : "Emissão de NFC-e desabilitada"}</span>
                <a href={`/o/${orgId}/markets/${m.id}`} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-subtle px-3 text-sm font-semibold text-link hover:bg-brand-100 dark:hover:bg-brand-950">Gerenciar mercado <Icon name="arrow" className="size-4" /></a>
              </div>
            </Card>
          ))}
        </div>
      )}
      {can(role, "market:write") && (
        <div id="new-market" className="scroll-mt-8"><Card icon="plus" title="Novo mercado" description="Cadastre uma unidade e organize sua operação por endereço.">
          <form action={createMarketAction.bind(null, orgId)} className="grid gap-4 sm:grid-cols-3">
            <Field label="Nome"><Input name="name" required minLength={2} /></Field>
            <Field label="Endereço"><Input name="address" /></Field>
            <Field label="CNPJ"><Input name="cnpj" inputMode="numeric" /></Field>
            <div className="sm:col-span-3">
              <Button type="submit">Cadastrar</Button>
            </div>
          </form>
        </Card></div>
      )}
    </main>
  );
}
