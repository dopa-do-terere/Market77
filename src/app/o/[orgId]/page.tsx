import { requireOrg } from "@/auth/guard";
import { withOrg } from "@/db/tenant";
import { listMarkets } from "@/domain/markets";
import { listLowStock } from "@/domain/stock";

export default async function Dashboard({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  await requireOrg(orgId, "stock:read");
  const markets = await withOrg(orgId, async (tx) =>
    Promise.all((await listMarkets(tx)).map(async (m) => ({ ...m, low: await listLowStock(tx, m.id) }))),
  );
  return (
    <main>
      <h1>Painel</h1>
      {markets.length === 0 && <p>Nenhum mercado cadastrado ainda.</p>}
      <ul>
        {markets.map((m) => (
          <li key={m.id}>
            <a href={`/o/${orgId}/markets/${m.id}`}>{m.name}</a>
            {m.low.length > 0 && <strong> ({m.low.length} produto(s) com estoque baixo)</strong>}
          </li>
        ))}
      </ul>
    </main>
  );
}
