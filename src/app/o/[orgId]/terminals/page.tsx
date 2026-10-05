import { releaseStore } from "@/agent/releases";
import { requireOrgPage } from "@/auth/guard";
import { userEmails } from "@/auth/service";
import { withOrg } from "@/db/tenant";
import { isOnline, listCommands } from "@/domain/agent";
import { listMarkets } from "@/domain/markets";
import { listTerminals } from "@/domain/terminals";
import { COMMAND_LABEL, COMMAND_STATUS_LABEL } from "@/lib/labels";
import { message } from "@/lib/messages";
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
    <main>
      <h1>Totens</h1>
      {error && <p role="alert">{message(error)}</p>}
      <TerminalForm orgId={orgId} markets={markets.map((m) => ({ id: m.id, name: m.name }))} />
      {markets.length === 0 && <p>Cadastre um mercado antes de cadastrar um totem.</p>}
      <table>
        <thead>
          <tr>
            <th>Nome</th><th>Mercado</th><th>Estado</th><th>Última batida</th><th>Agente</th><th>PDV</th><th>Point</th><th>Ações</th>
          </tr>
        </thead>
        <tbody>
          {terminals.map((t) => {
            const state = t.revokedAt
              ? "revogado"
              : t.lastHeartbeatAt === null
                ? "nunca conectou"
                : isOnline(t.lastHeartbeatAt, now)
                  ? "online"
                  : "offline";
            const send = (type: string) => sendCommandAction.bind(null, orgId, t.id, type);
            return [
              <tr key={t.id}>
                <td>{t.name}</td>
                <td>{t.marketName}</td>
                <td>{state === "offline" ? <strong>offline</strong> : state}</td>
                <td>{t.lastHeartbeatAt?.toLocaleString("pt-BR", { timeZone: t.timezone }) ?? "-"}</td>
                <td>{t.agentVersion ?? "-"}</td>
                <td>{t.pdvStatus === "running" ? "aberto" : t.pdvStatus === "stopped" ? "parado" : "-"}</td>
                <td>
                  {!t.revokedAt && (
                    <form action={setTerminalDeviceAction.bind(null, orgId, t.id)} style={{ display: "inline" }}>
                      <input
                        name="pointDeviceId"
                        defaultValue={t.pointDeviceId ?? ""}
                        placeholder="sem maquininha"
                        maxLength={64}
                        pattern="[\x21-\x7e]+"
                        title="Sem espaços"
                        size={22}
                      />{" "}
                      <button type="submit">Salvar</button>
                    </form>
                  )}
                </td>
                <td>
                  {!t.revokedAt && (
                    <>
                      <form action={send("restart_pdv")} style={{ display: "inline" }}>
                        <button type="submit">{COMMAND_LABEL.restart_pdv}</button>
                      </form>{" "}
                      <form action={send("reboot")} style={{ display: "inline" }}>
                        <button type="submit">{COMMAND_LABEL.reboot}</button>
                      </form>{" "}
                      {latest && (
                        <form action={send("update")} style={{ display: "inline" }}>
                          <button type="submit" disabled={t.agentVersion === latest.version}>
                            {COMMAND_LABEL.update} para {latest.version}
                          </button>
                        </form>
                      )}{" "}
                      <form action={revokeTerminalAction.bind(null, orgId, t.id)} style={{ display: "inline" }}>
                        <button type="submit">Revogar</button>
                      </form>
                    </>
                  )}
                </td>
              </tr>,
              <tr key={`${t.id}-history`}>
                <td colSpan={8}>
                  <small>
                    {(history.get(t.id) ?? []).length === 0
                      ? "Nenhum comando enviado."
                      : (history.get(t.id) ?? [])
                          .map(
                            (c) =>
                              `${COMMAND_LABEL[c.type]} (${emails.get(c.createdBy ?? "") ?? "desconhecido"}, ${c.createdAt.toLocaleString("pt-BR", { timeZone: t.timezone })}): ${COMMAND_STATUS_LABEL[c.status]}${c.error ? ` [${c.error}]` : ""}`,
                          )
                          .join(" | ")}
                  </small>
                </td>
              </tr>,
            ];
          })}
        </tbody>
      </table>
    </main>
  );
}
