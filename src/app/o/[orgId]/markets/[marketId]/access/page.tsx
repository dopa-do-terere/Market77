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
import { Alert, Badge, Button, Card, PageHeader, Table } from "@/ui";
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
    <main className="space-y-6">
      <PageHeader title={`Acessos: ${market.name}`} />
      {(error || dayError) && <Alert tone="danger">{message(error ?? dayError ?? "")}</Alert>}

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Resumo por dia</h2>
        <Table>
          <thead>
            <tr><th>Dia</th><th>Entradas</th><th>Pessoas</th><th>Vendas pagas</th><th>Vendas por entrada</th></tr>
          </thead>
          <tbody>
            {summary.map((r) => (
              <tr key={r.day}>
                <td><a href={`?day=${r.day}`} className="font-medium text-link hover:underline">{formatDay(r.day)}</a></td>
                <td>{r.entries}</td>
                <td>{r.people}</td>
                <td>{r.paidSales}</td>
                <td>{ratio(r.salesPerEntry)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </section>

      {chosen && !dayError && (
        hourly.every((h) => h.entries === 0) ? (
          <Card title={`Entradas por hora em ${formatDay(chosen)}`}>
            <p className="text-muted">Nenhuma entrada neste dia.</p>
          </Card>
        ) : (
          <section className="space-y-3">
            <h2 className="text-base font-semibold">Entradas por hora em {formatDay(chosen)}</h2>
            <Table>
              <thead>
                <tr><th>Hora</th><th>Entradas</th></tr>
              </thead>
              <tbody>
                {hourly.filter((h) => h.entries > 0).map((h) => (
                  <tr key={h.hour}><td>{String(h.hour).padStart(2, "0")}h</td><td>{h.entries}</td></tr>
                ))}
              </tbody>
            </Table>
          </section>
        )
      )}

      <Card title="Acessos recentes">
        {recent.length === 0 && <p className="text-muted">Nenhum acesso registrado ainda.</p>}
        <ul className="-my-4 divide-y divide-border">
          {recent.map((e) => (
            <li key={e.id} className="py-3">
              <span className="text-muted">{when(e.occurredAt)}, {e.sourceName}:</span> {personLabel(e)}
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Pessoas">
        {people.length === 0 && <p className="text-muted">Nenhuma pessoa sincronizada ainda.</p>}
        <ul className="-my-4 divide-y divide-border">
          {people.map((p) => (
            <li key={p.id} className="py-3">
              {p.forgotten ? "Removida a pedido" : p.name}{" "}
              <span className="text-muted">
                (id {p.externalId}, {p.sourceName}
                {!p.active && !p.forgotten ? ", inativa" : ""})
              </span>
              {canWrite && !p.forgotten && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-sm font-medium text-link">Esquecer pessoa</summary>
                  <p className="mt-2 text-sm text-muted">Apaga o nome e o identificador dos acessos antigos. Não pode ser desfeito.</p>
                  <form action={forgetAccessPersonAction.bind(null, orgId, marketId, p.id)} className="mt-2">
                    <Button type="submit" variant="secondary">Confirmar</Button>
                  </form>
                </details>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Leitores">
        <div className="space-y-4">
          {canWrite && <AccessSourceForm orgId={orgId} marketId={marketId} />}
          {sources.length === 0 && <p className="text-muted">Nenhum leitor cadastrado.</p>}
          <ul className="divide-y divide-border">
            {sources.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2 py-3">
                <strong>{s.name}</strong>
                {s.revokedAt && <Badge tone="neutral">revogado</Badge>}
                <span className="text-muted">
                  {s.activePeople} pessoa(s) ativa(s), última sincronização {s.lastSyncAt ? when(s.lastSyncAt) : "nunca"},
                  último evento {s.lastEventAt ? when(s.lastEventAt) : "nunca"}
                </span>
                {s.lastSyncError && <Badge tone="danger">erro na sincronização: {s.lastSyncError}</Badge>}
                {canWrite && !s.revokedAt && (
                  <form action={revokeAccessSourceAction.bind(null, orgId, marketId, s.id)}>
                    <Button type="submit" variant="secondary">Revogar</Button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </div>
      </Card>
      <p>
        <a href={`/o/${orgId}/markets/${marketId}`} className="font-medium text-link hover:underline">
          Voltar ao mercado
        </a>
      </p>
    </main>
  );
}
