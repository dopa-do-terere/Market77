import { requireOrg } from "@/auth/guard";
import { can } from "@/auth/permissions";
import { withOrg } from "@/db/tenant";
import { listMarkets } from "@/domain/markets";
import { message } from "@/lib/messages";
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
  const { role } = await requireOrg(orgId, "catalog:read");
  const markets = await withOrg(orgId, (tx) => listMarkets(tx));
  return (
    <main>
      <h1>Mercados</h1>
      {error && <p role="alert">{message(error)}</p>}
      <ul>
        {markets.map((m) => (
          <li key={m.id}><a href={`/o/${orgId}/markets/${m.id}`}>{m.name}</a> {m.address}</li>
        ))}
      </ul>
      {can(role, "market:write") && (
        <form action={createMarketAction.bind(null, orgId)}>
          <h2>Novo mercado</h2>
          <label>Nome <input name="name" required minLength={2} /></label>
          <label>Endereço <input name="address" /></label>
          <label>CNPJ <input name="cnpj" inputMode="numeric" /></label>
          <button type="submit">Cadastrar</button>
        </form>
      )}
    </main>
  );
}
