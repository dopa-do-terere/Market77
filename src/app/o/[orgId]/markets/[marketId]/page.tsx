import { notFound } from "next/navigation";
import { z } from "zod";
import { requireOrgPage } from "@/auth/guard";
import { can } from "@/auth/permissions";
import { withOrg } from "@/db/tenant";
import { type LotBalance, formatDay, listExpiryAlerts, listLotBalances } from "@/domain/lots";
import { listMarketProducts } from "@/domain/market-products";
import { UFS, listMarkets } from "@/domain/markets";
import { listProducts } from "@/domain/products";
import { message } from "@/lib/messages";
import { formatBRL } from "@/lib/money";
import { Alert, Badge, Button, ButtonLink, Icon, Card, Checkbox, EmptyState, StatCard, Field, Input, PageHeader, Select, Table } from "@/ui";
import { moveStockAction, setMarketProductAction, updateMarketFiscalAction } from "./actions";

export default async function MarketPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string; marketId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { orgId, marketId } = await params;
  const { error } = await searchParams;
  const { role } = await requireOrgPage(orgId, "stock:read");
  if (!z.string().uuid().safeParse(marketId).success) notFound();
  const { rows, products, lots, alerts, market } = await withOrg(orgId, async (tx) => {
    const rows = await listMarketProducts(tx, marketId);
    const lots = new Map<string, LotBalance[]>();
    for (const r of rows) {
      if (r.tracksExpiry) lots.set(r.id, (await listLotBalances(tx, r.id)).filter((l) => l.balance > 0));
    }
    return {
      rows,
      lots,
      products: await listProducts(tx),
      market: (await listMarkets(tx)).find((m) => m.id === marketId),
      alerts: await listExpiryAlerts(tx, marketId, new Date()),
    };
  });
  return (
    <main className="space-y-6">
      <PageHeader
        icon="market"
        title={market?.name ?? "Estoque do mercado"}
        description="Produtos, reposição e validade da sua unidade."
        actions={
          <>
            <ButtonLink href={`/o/${orgId}/markets`} variant="secondary"><Icon name="back" /> Mercados</ButtonLink>
            {can(role, "access:read") && <ButtonLink href={`/o/${orgId}/markets/${marketId}/access`} variant="secondary"><Icon name="team" /> Acessos</ButtonLink>}
          </>
        }
      />
      {error && <Alert tone="danger">{message(error)}</Alert>}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Produtos na unidade" value={rows.length} note="Itens vinculados a este mercado" icon="product" featured />
        <StatCard label="Precisam de reposição" value={rows.filter((r) => r.balance <= r.minStock).length} note="Saldo igual ou abaixo do estoque mínimo" icon="market" />
        <StatCard label="Lotes vencidos" value={alerts.filter((a) => a.status === "expired").length} note="Confira a seção de validade abaixo" icon="warning" />
      </div>
      <Table title="Estoque e movimentações" description="Consulte saldos e registre entradas, perdas e ajustes.">
        <thead>
          <tr><th>Produto</th><th>Preço</th><th>Mínimo</th><th>Saldo</th><th>Ativo</th><th>Validade</th><th>Movimentar</th></tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={7}><EmptyState icon="product" title="Prepare as prateleiras" description="Vincule os produtos do catálogo a este mercado para definir preços e registrar estoque." /></td></tr>}
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="font-medium">{r.name}</td>
              <td>{formatBRL(r.priceCents)}</td>
              <td>{r.minStock}</td>
              <td>
                {r.balance < 0 ? (
                  <Badge tone="danger">{r.balance} (negativo)</Badge>
                ) : r.balance <= r.minStock ? (
                  <Badge tone="warning">{r.balance} (baixo)</Badge>
                ) : (
                  r.balance
                )}
              </td>
              <td>{r.active ? "sim" : "não"}</td>
              <td>{r.tracksExpiry ? "controla" : "não"}</td>
              <td>
                {can(role, "stock:move") && (
                  <form action={moveStockAction.bind(null, orgId, marketId, r.id)} className="flex flex-wrap items-end gap-2">
                    <Select name="type" defaultValue="in" aria-label="Tipo de movimento">
                      <option value="in">Entrada</option>
                      <option value="sale">Venda</option>
                      <option value="loss">Perda</option>
                      <option value="adjustment">Ajuste (use sinal)</option>
                    </Select>
                    <Input name="quantity" type="number" step="1" required className="w-24" aria-label="Quantidade" />
                    {r.tracksExpiry && (
                      <>
                        <Field label="Validade (entrada)">
                          <Input name="expiresOn" type="date" />
                        </Field>
                        <Select name="lotId" defaultValue="" aria-label="Lote">
                          <option value="">Lote: o que vence primeiro</option>
                          {(lots.get(r.id) ?? []).map((l) => (
                            <option key={l.id} value={l.id}>
                              {formatDay(l.expiresOn)} ({l.balance})
                            </option>
                          ))}
                        </Select>
                      </>
                    )}
                    <Input name="note" placeholder="Observação" aria-label="Observação" />
                    <Button type="submit" variant="secondary">Registrar</Button>
                  </form>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      {alerts.length === 0 ? (
        <Card icon="check" title="Validade em dia">
          <p className="text-sm text-muted">Nenhum lote vencido ou vencendo nos próximos 7 dias.</p>
        </Card>
      ) : (
        <section className="space-y-3">
          <h2 className="text-base font-semibold">Validade</h2>
          <Table>
            <thead>
              <tr><th>Produto</th><th>Validade</th><th>Quantidade</th><th>Situação</th></tr>
            </thead>
            <tbody>
              {alerts.map((a) => (
                <tr key={a.lotId}>
                  <td>{a.productName}</td>
                  <td>{formatDay(a.expiresOn)}</td>
                  <td>{a.quantity}</td>
                  <td>
                    {a.status === "expired" ? <Badge tone="danger">Vencido</Badge> : <Badge tone="warning">Vence em breve</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </section>
      )}
      {can(role, "price:write") && (
        <Card icon="product" title="Produtos deste mercado" description="Vincule um produto ou atualize preço, estoque mínimo e controle de validade.">
          <form action={setMarketProductAction.bind(null, orgId, marketId)} className="grid gap-4 sm:grid-cols-3">
            <Field label="Produto">
              <Select name="productId" required>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>
            <Field label="Preço (R$)"><Input name="price" required inputMode="decimal" placeholder="5,90" /></Field>
            <Field label="Estoque mínimo"><Input name="minStock" type="number" min={0} defaultValue={0} /></Field>
            <Field label="Controla validade">
              <Select name="tracksExpiry" defaultValue="">
                <option value="">Manter</option>
                <option value="on">Ligar</option>
                <option value="off">Desligar</option>
              </Select>
            </Field>
            <div className="flex items-end">
              <Checkbox name="active" label="Ativo" defaultChecked />
            </div>
            <div className="sm:col-span-3">
              <Button type="submit">Salvar</Button>
            </div>
          </form>
        </Card>
      )}
      {market && can(role, "market:write") && (
        <Card icon="sales" title="Dados fiscais (NFC-e)" description="Configure a emissão de notas para esta unidade.">
          <form action={updateMarketFiscalAction.bind(null, orgId, marketId)} className="grid gap-4 sm:grid-cols-3">
            <div className="flex items-end sm:col-span-3">
              <Checkbox name="nfceEnabled" label="Emitir NFC-e" defaultChecked={market.nfceEnabled} />
            </div>
            <Field label="CNPJ"><Input name="cnpj" inputMode="numeric" defaultValue={market.cnpj ?? ""} /></Field>
            <Field label="Inscrição estadual"><Input name="stateRegistration" defaultValue={market.stateRegistration ?? ""} /></Field>
            <Field label="UF">
              <Select name="uf" defaultValue={market.uf ?? ""}>
                <option value="">Escolha</option>
                {UFS.map((u) => <option key={u} value={u}>{u}</option>)}
              </Select>
            </Field>
            <Field label="Regime">
              <Select name="taxRegime" defaultValue={market.taxRegime}>
                <option value="simples">Simples Nacional</option>
                <option value="normal">Regime normal (ainda não emite)</option>
              </Select>
            </Field>
            <Field label="Série"><Input name="nfceSeries" type="number" min={1} max={999} defaultValue={market.nfceSeries} /></Field>
            <div className="sm:col-span-3">
              <Button type="submit">Salvar dados fiscais</Button>
            </div>
          </form>
        </Card>
      )}
    </main>
  );
}
