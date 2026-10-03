import { requireOrgPage } from "@/auth/guard";
import { withOrg } from "@/db/tenant";
import { listMarkets } from "@/domain/markets";
import { listTerminals } from "@/domain/terminals";
import { message } from "@/lib/messages";
import { TerminalForm } from "./TerminalForm";
import { revokeTerminalAction } from "./actions";

export default async function TerminalsPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { orgId } = await params;
  const { error } = await searchParams;
  await requireOrgPage(orgId, "terminal:write");
  const { terminals, markets } = await withOrg(orgId, async (tx) => ({
    terminals: await listTerminals(tx),
    markets: await listMarkets(tx),
  }));
  return (
    <main>
      <h1>Totens</h1>
      {error && <p role="alert">{message(error)}</p>}
      <TerminalForm orgId={orgId} markets={markets.map((m) => ({ id: m.id, name: m.name }))} />
      {markets.length === 0 && <p>Cadastre um mercado antes de cadastrar um totem.</p>}
      <table>
        <thead>
          <tr><th>Nome</th><th>Mercado</th><th>Situação</th><th>Ação</th></tr>
        </thead>
        <tbody>
          {terminals.map((t) => (
            <tr key={t.id}>
              <td>{t.name}</td>
              <td>{t.marketName}</td>
              <td>{t.revokedAt ? "revogado" : "ativo"}</td>
              <td>
                {!t.revokedAt && (
                  <form action={revokeTerminalAction.bind(null, orgId, t.id)}>
                    <button type="submit">Revogar</button>
                  </form>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
