import { requireOrgPage } from "@/auth/guard";
import { can } from "@/auth/permissions";
import { withOrg } from "@/db/tenant";
import { listMarkets } from "@/domain/markets";
import { message } from "@/lib/messages";
import { Alert, Button, Card, Field, Input, PageHeader } from "@/ui";
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
      <PageHeader title="Mercados" description="Gerencie suas unidades e acompanhe a operação de cada mercado." />
      {error && <Alert tone="danger">{message(error)}</Alert>}
      <Card>
        {markets.length === 0 && <p className="text-muted">Nenhum mercado cadastrado ainda.</p>}
        <ul className="-my-4 divide-y divide-border">
          {markets.map((m) => (
            <li key={m.id} className="py-3">
              <a href={`/o/${orgId}/markets/${m.id}`} className="font-medium text-link hover:underline">
                {m.name}
              </a>{" "}
              <span className="text-muted">{m.address}</span>
            </li>
          ))}
        </ul>
      </Card>
      {can(role, "market:write") && (
        <div id="new-market" className="scroll-mt-8"><Card title="Novo mercado">
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
