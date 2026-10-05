import { notFound } from "next/navigation";
import { z } from "zod";
import { requireOrgPage } from "@/auth/guard";
import { can } from "@/auth/permissions";
import { withOrg } from "@/db/tenant";
import {
  type HourlyAccessRow,
  dailyAccessSummary,
  hourlyAccess,
  listAccessPeople,
  listAccessSources,
  listRecentAccess,
} from "@/domain/access";
import { listMarkets } from "@/domain/markets";
import { formatDay } from "@/domain/lots";
import { AppError } from "@/lib/errors";
import { message } from "@/lib/messages";
import { AccessSourceForm } from "./AccessSourceForm";
import { forgetAccessPersonAction, revokeAccessSourceAction } from "./actions";

export default async function AccessPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string; marketId: string }>;
  searchParams: Promise<{ error?: string; day?: string }>;
}) {
  const { orgId, marketId } = await params;
  const { error, day } = await searchParams;
  const { role } = await requireOrgPage(orgId, "access:read");
  if (!z.string().uuid().safeParse(marketId).success) notFound();
  const now = new Date();
  const data = await withOrg(orgId, async (tx) => {
    const market = (await listMarkets(tx)).find((m) => m.id === marketId);
    if (!market) return null;
    const summary = await dailyAccessSummary(tx, marketId, now);
    const chosen = day ?? summary[0]?.day;
    let hourly: HourlyAccessRow[] = [];
    let dayError: string | null = null;
    if (chosen) {
      try {
        hourly = await hourlyAccess(tx, marketId, chosen);
      } catch (e) {
        if (!(e instanceof AppError)) throw e;
        dayError = e.code;
      }
    }
    return {
      market,
      summary,
      chosen,
      hourly,
      dayError,
      sources: await listAccessSources(tx, marketId),
      people: await listAccessPeople(tx, marketId),
      recent: await listRecentAccess(tx, marketId),
    };
  });
  if (!data) notFound();
  const { market, summary, chosen, hourly, dayError, sources, people, recent } = data;
  const when = (d: Date) => d.toLocaleString("pt-BR", { timeZone: market.timezone });
  const canWrite = can(role, "access:write");
  const ratio = (n: number | null) => (n === null ? "-" : n.toFixed(2).replace(".", ","));
  const personLabel = (e: (typeof recent)[number]) =>
    e.status === "known"
      ? e.personName
      : e.status === "unregistered"
        ? `Pessoa não cadastrada (id ${e.personExternalId})`
        : "Não identificada";
  return (
    <main>
      <h1>Acessos: {market.name}</h1>
      {(error || dayError) && <p role="alert">{message(error ?? dayError ?? "")}</p>}

      <h2>Resumo por dia</h2>
      <table>
        <thead>
          <tr><th>Dia</th><th>Entradas</th><th>Pessoas</th><th>Vendas pagas</th><th>Vendas por entrada</th></tr>
        </thead>
        <tbody>
          {summary.map((r) => (
            <tr key={r.day}>
              <td><a href={`?day=${r.day}`}>{formatDay(r.day)}</a></td>
              <td>{r.entries}</td>
              <td>{r.people}</td>
              <td>{r.paidSales}</td>
              <td>{ratio(r.salesPerEntry)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {chosen && !dayError && (
        <>
          <h2>Entradas por hora em {formatDay(chosen)}</h2>
          <table>
            <thead>
              <tr><th>Hora</th><th>Entradas</th></tr>
            </thead>
            <tbody>
              {hourly.filter((h) => h.entries > 0).map((h) => (
                <tr key={h.hour}><td>{String(h.hour).padStart(2, "0")}h</td><td>{h.entries}</td></tr>
              ))}
            </tbody>
          </table>
          {hourly.every((h) => h.entries === 0) && <p>Nenhuma entrada neste dia.</p>}
        </>
      )}

      <h2>Acessos recentes</h2>
      {recent.length === 0 && <p>Nenhum acesso registrado ainda.</p>}
      <ul>
        {recent.map((e) => (
          <li key={e.id}>
            {when(e.occurredAt)}, {e.sourceName}: {personLabel(e)}
          </li>
        ))}
      </ul>

      <h2>Pessoas</h2>
      {people.length === 0 && <p>Nenhuma pessoa sincronizada ainda.</p>}
      <ul>
        {people.map((p) => (
          <li key={p.id}>
            {p.forgotten ? "Removida a pedido" : p.name} (id {p.externalId}, {p.sourceName}
            {!p.active && !p.forgotten ? ", inativa" : ""})
            {canWrite && !p.forgotten && (
              <details>
                <summary>Esquecer pessoa</summary>
                <p>Apaga o nome e o identificador dos acessos antigos. Não pode ser desfeito.</p>
                <form action={forgetAccessPersonAction.bind(null, orgId, marketId, p.id)}>
                  <button type="submit">Confirmar</button>
                </form>
              </details>
            )}
          </li>
        ))}
      </ul>

      <h2>Leitores</h2>
      {canWrite && <AccessSourceForm orgId={orgId} marketId={marketId} />}
      {sources.length === 0 && <p>Nenhum leitor cadastrado.</p>}
      <ul>
        {sources.map((s) => (
          <li key={s.id}>
            <strong>{s.name}</strong>
            {s.revokedAt ? " (revogado)" : ""}: {s.activePeople} pessoa(s) ativa(s), última sincronização{" "}
            {s.lastSyncAt ? when(s.lastSyncAt) : "nunca"}, último evento {s.lastEventAt ? when(s.lastEventAt) : "nunca"}
            {s.lastSyncError && <strong role="alert"> (erro na sincronização: {s.lastSyncError})</strong>}
            {canWrite && !s.revokedAt && (
              <form action={revokeAccessSourceAction.bind(null, orgId, marketId, s.id)} style={{ display: "inline" }}>
                {" "}
                <button type="submit">Revogar</button>
              </form>
            )}
          </li>
        ))}
      </ul>
      <p>
        <a href={`/o/${orgId}/markets/${marketId}`}>Voltar ao mercado</a>
      </p>
    </main>
  );
}
