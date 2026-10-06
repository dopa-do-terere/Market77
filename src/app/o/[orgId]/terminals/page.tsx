import { releaseStore } from "@/agent/releases";
import { requireOrgPage } from "@/auth/guard";
import { userEmails } from "@/auth/service";
import { withOrg } from "@/db/tenant";
import { isOnline, listCommands } from "@/domain/agent";
import { listMarkets } from "@/domain/markets";
import { listTerminals } from "@/domain/terminals";
import { COMMAND_LABEL, COMMAND_STATUS_LABEL } from "@/lib/labels";
import { message } from "@/lib/messages";
import { Alert, Badge, Button, COMMAND_TONE, EmptyState, StatCard, Input, PageHeader, Table } from "@/ui";
import { TerminalForm } from "./TerminalForm";
import { revokeTerminalAction, sendCommandAction, setTerminalDeviceAction } from "./actions";

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
  const now = new Date();
  const latest = await releaseStore.latest();
  const { terminals, markets, history } = await withOrg(orgId, async (tx) => {
    const terminals = await listTerminals(tx);
    return {
      terminals,
      markets: await listMarkets(tx),
      history: new Map(await Promise.all(terminals.map(async (t) => [t.id, await listCommands(tx, t.id)] as const))),
    };
  });
  const emails = await userEmails(
    [...history.values()].flat().map((c) => c.createdBy).filter((id): id is string => id !== null),
  );
  return (
    <main className="space-y-6">
      <PageHeader icon="terminal" title="Totens" description="Acompanhe a conexão dos equipamentos e gerencie o autoatendimento." />
      {error && <Alert tone="danger">{message(error)}</Alert>}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Totens ativos" value={terminals.filter((t) => !t.revokedAt).length} note="Equipamentos com acesso autorizado" icon="terminal" featured />
        <StatCard label="Online agora" value={terminals.filter((t) => !t.revokedAt && t.lastHeartbeatAt && isOnline(t.lastHeartbeatAt, now)).length} note="Com comunicação recente com o sistema" icon="check" />
        <StatCard label="Sem comunicação" value={terminals.filter((t) => !t.revokedAt && (!t.lastHeartbeatAt || !isOnline(t.lastHeartbeatAt, now))).length} note="Offline ou ainda não conectados" icon="warning" />
      </div>
      <TerminalForm orgId={orgId} markets={markets.map((m) => ({ id: m.id, name: m.name }))} />
      {markets.length === 0 && <Alert tone="info">Cadastre um mercado antes de cadastrar um totem.</Alert>}
      <Table title="Seus equipamentos" description="Conexão, versão do agente e comandos remotos por totem.">
        <thead>
          <tr>
            <th>Nome</th><th>Mercado</th><th>Estado</th><th>Última batida</th><th>Agente</th><th>PDV</th><th>Point</th><th>Ações</th>
          </tr>
        </thead>
        <tbody>
          {terminals.length === 0 && <tr><td colSpan={8}><EmptyState icon="terminal" title="Conecte seu primeiro totem" description="Cadastre o equipamento e use o token gerado para ativar o autoatendimento." /></td></tr>}
          {terminals.map((t) => {
            const state = t.revokedAt
              ? "revogado"
              : t.lastHeartbeatAt === null
                ? "nunca conectou"
                : isOnline(t.lastHeartbeatAt, now)
                  ? "online"
                  : "offline";
            const send = (type: string) => sendCommandAction.bind(null, orgId, t.id, type);
            const commands = history.get(t.id) ?? [];
            return [
              <tr key={t.id}>
                <td className="font-medium">{t.name}</td>
                <td>{t.marketName}</td>
                <td>
                  <Badge tone={state === "online" ? "success" : state === "offline" ? "danger" : "neutral"}>{state}</Badge>
                </td>
                <td>{t.lastHeartbeatAt?.toLocaleString("pt-BR", { timeZone: t.timezone }) ?? "-"}</td>
                <td>{t.agentVersion ?? "-"}</td>
                <td>{t.pdvStatus === "running" ? "aberto" : t.pdvStatus === "stopped" ? "parado" : "-"}</td>
                <td>
                  {!t.revokedAt && (
                    <form action={setTerminalDeviceAction.bind(null, orgId, t.id)} className="flex gap-2">
                      <Input
                        name="pointDeviceId" aria-label="ID da maquininha Point"
                        defaultValue={t.pointDeviceId ?? ""}
                        placeholder="sem maquininha"
                        maxLength={64}
                        pattern="[\x21-\x7e]+"
                        title="Sem espaços"
                        className="w-44"
                      />
                      <Button type="submit" variant="secondary">Salvar</Button>
                    </form>
                  )}
                </td>
                <td>
                  {!t.revokedAt && (
                    <div className="flex flex-wrap gap-2">
                      <form action={send("restart_pdv")}>
                        <Button type="submit" variant="secondary">{COMMAND_LABEL.restart_pdv}</Button>
                      </form>
                      <form action={send("reboot")}>
                        <Button type="submit" variant="secondary">{COMMAND_LABEL.reboot}</Button>
                      </form>
                      {latest && (
                        <form action={send("update")}>
                          <Button type="submit" variant="secondary" disabled={t.agentVersion === latest.version}>
                            {COMMAND_LABEL.update} para {latest.version}
                          </Button>
                        </form>
                      )}
                      <form action={revokeTerminalAction.bind(null, orgId, t.id)}>
                        <Button type="submit" variant="secondary">Revogar</Button>
                      </form>
                    </div>
                  )}
                </td>
              </tr>,
              <tr key={`${t.id}-history`}>
                <td colSpan={8} className="bg-subtle">
                  {commands.length === 0 ? (
                    <small className="text-muted">Nenhum comando enviado.</small>
                  ) : (
                    <ul className="space-y-1">
                      {commands.map((c) => (
                        <li key={c.id} className="flex flex-wrap items-center gap-2 text-xs text-muted">
                          <span>
                            {COMMAND_LABEL[c.type]} ({emails.get(c.createdBy ?? "") ?? "desconhecido"},{" "}
                            {c.createdAt.toLocaleString("pt-BR", { timeZone: t.timezone })})
                          </span>
                          <Badge tone={COMMAND_TONE[c.status] ?? "neutral"}>{COMMAND_STATUS_LABEL[c.status]}</Badge>
                          {c.error && <span>[{c.error}]</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
              </tr>,
            ];
          })}
        </tbody>
      </Table>
    </main>
  );
}
