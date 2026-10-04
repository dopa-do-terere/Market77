import { notFound } from "next/navigation";
import { z } from "zod";
import { requireOrgPage } from "@/auth/guard";
import { can } from "@/auth/permissions";
import { withOrg } from "@/db/tenant";
import { type LotBalance, formatDay, listExpiryAlerts, listLotBalances } from "@/domain/lots";
import { listMarketProducts } from "@/domain/market-products";
import { listProducts } from "@/domain/products";
import { message } from "@/lib/messages";
import { formatBRL } from "@/lib/money";
import { moveStockAction, setMarketProductAction } from "./actions";

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
  const { rows, products, lots, alerts } = await withOrg(orgId, async (tx) => {
    const rows = await listMarketProducts(tx, marketId);
    const lots = new Map<string, LotBalance[]>();
    for (const r of rows) {
      if (r.tracksExpiry) lots.set(r.id, (await listLotBalances(tx, r.id)).filter((l) => l.balance > 0));
    }
    return {
      rows,
      lots,
      products: await listProducts(tx),
      alerts: await listExpiryAlerts(tx, marketId, new Date()),
    };
  });
  return (
    <main>
      <h1>Estoque do mercado</h1>
      {error && <p role="alert">{message(error)}</p>}
      <table>
        <thead>
          <tr><th>Produto</th><th>Preço</th><th>Mínimo</th><th>Saldo</th><th>Ativo</th><th>Validade</th><th>Movimentar</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.name}</td>
              <td>{formatBRL(r.priceCents)}</td>
              <td>{r.minStock}</td>
              <td>
                {r.balance < 0 ? (
                  <strong>{r.balance} (negativo)</strong>
                ) : r.balance <= r.minStock ? (
                  <strong>{r.balance} (baixo)</strong>
                ) : (
                  r.balance
                )}
              </td>
              <td>{r.active ? "sim" : "não"}</td>
              <td>{r.tracksExpiry ? "controla" : "não"}</td>
              <td>
                {can(role, "stock:move") && (
                  <form action={moveStockAction.bind(null, orgId, marketId, r.id)}>
                    <select name="type" defaultValue="in">
                      <option value="in">Entrada</option>
                      <option value="sale">Venda</option>
                      <option value="loss">Perda</option>
                      <option value="adjustment">Ajuste (use sinal)</option>
                    </select>
                    <input name="quantity" type="number" step="1" required />
                    {r.tracksExpiry && (
                      <>
                        <label>
                          Validade (entrada) <input name="expiresOn" type="date" />
                        </label>
                        <select name="lotId" defaultValue="">
                          <option value="">Lote: o que vence primeiro</option>
                          {(lots.get(r.id) ?? []).map((l) => (
                            <option key={l.id} value={l.id}>
                              {formatDay(l.expiresOn)} ({l.balance})
                            </option>
                          ))}
                        </select>
                      </>
                    )}
                    <input name="note" placeholder="Observação" />
                    <button type="submit">Registrar</button>
                  </form>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Validade</h2>
      {alerts.length === 0 ? (
        <p>Nenhum lote vencido ou vencendo em 7 dias.</p>
      ) : (
        <table>
          <thead>
            <tr><th>Produto</th><th>Validade</th><th>Quantidade</th><th>Situação</th></tr>
          </thead>
          <tbody>
            {alerts.map((a) => (
              <tr key={a.lotId}>
                <td>{a.productName}</td>
                <td>{formatDay(a.expiresOn)}</td>
                <td>{a.quantity}</td>
                <td>{a.status === "expired" ? <strong>Vencido</strong> : "Vence em breve"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {can(role, "price:write") && (
        <form action={setMarketProductAction.bind(null, orgId, marketId)}>
          <h2>Adicionar ou atualizar produto neste mercado</h2>
          <label>
            Produto{" "}
            <select name="productId" required>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label>Preço (R$) <input name="price" required inputMode="decimal" placeholder="5,90" /></label>
          <label>Estoque mínimo <input name="minStock" type="number" min={0} defaultValue={0} /></label>
          <label>Ativo <input name="active" type="checkbox" defaultChecked /></label>
          <label>Controla validade <input name="tracksExpiry" type="checkbox" /></label>
          <button type="submit">Salvar</button>
        </form>
      )}
    </main>
  );
}
