# Fase 3: Agente do totem e comandos remotos - Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O dono vê pelo painel se cada totem está vivo e o reinicia (PDV ou máquina) ou atualiza o agente sem ir à loja; o totem sobe sozinho no boot e abre o PDV em tela cheia.

**Architecture:** Monólito Next.js sobre as fases 1 e 2 mais um pacote novo, `agent/`, que roda no mini PC Ubuntu. O agente faz polling: a cada 30 s envia um heartbeat e recebe o próximo comando na resposta, sem porta de entrada no totem. Os comandos vivem em `terminal_commands` (entrega atômica por totem, reentrega e expiração). O pacote do agente fica no Postgres atrás da interface `ReleaseStore`. O agente é TypeScript executado direto pelo Node 22.18+ (remoção de tipos), só com a stdlib. A lógica do agente recebe tudo de fora (fetch, processo do Chromium, disco, comandos de sistema) para ser testada sem hardware.

**Tech Stack:** Next.js 15, React 19, TypeScript, Postgres 16, `postgres` (postgres.js), `zod`, `vitest`, `tsx` (todos já instalados). Nenhuma dependência nova. No totem: Node 22.18+, Chromium, `systemd`, `bash`, `tar`.

**Spec:** `docs/superpowers/specs/2026-10-03-fase-3-agente-totem-design.md` (spec geral: `docs/superpowers/specs/2026-10-01-market77-design.md`)

## Global Constraints

- Stack: Next.js + TypeScript, Postgres com Row Level Security; migrations em SQL puro, sem ORM. Nenhuma dependência nova no repositório.
- `terminal_commands` leva `org_id`, RLS pela política da fase 1 (`nullif(current_setting('app.org_id', true), '')::uuid`, `USING` e `WITH CHECK`) e FK composta `(terminal_id, org_id)`. Todo acesso a ela passa por `withOrg()`. `agent_releases` não tem `org_id` nem RLS; só `adminSql` a toca, e o papel `market77_app` não recebe permissão nela.
- O agente do totem usa o token de totem da fase 2 (`Authorization: Bearer`, `requireTerminal`). Rotas do agente respondem `{ error, message }` com `message` em português, como as do PDV. Id fora do formato UUID e versão fora do formato vira 404, JSON quebrado vira 400; nada disso pode dar 500.
- Heartbeat a cada 30 s com timeout de 10 s. Online: última batida há no máximo 2 minutos (`ONLINE_WINDOW_MS = 120000`). Reentrega de comando `delivered` sem resultado após 2 minutos. Comando `pending` ou `delivered` com mais de 10 minutos de idade expira (`failed`, erro `expired`) e nunca é entregue. Cinco falhas seguidas de heartbeat reiniciam o Chromium; o agente nunca reinicia a máquina sozinho.
- Versão do agente: `^\d{1,4}\.\d{1,4}\.\d{1,4}$`. Pacote: gzip (começa com `1f 8b`), no máximo 20 MB (`20 * 1024 * 1024`), SHA-256 calculado pelo servidor e conferido pelo agente.
- Comandos: só `restart_pdv`, `reboot` e `update`. O agente nunca passa texto vindo do servidor a um shell; só `execFile` com argumentos fixos. Um único comando por vez por totem. Um comando aberto por tipo por totem (índice único parcial).
- O código do agente (`agent/*.ts`) é executado pelo Node só removendo tipos: sem `enum`, `namespace` nem parameter properties; imports relativos terminam em `.ts`. O agente não importa nada de `src/` nem de `node_modules`.
- Segredos novos: `RELEASE_SECRET` (publicar pacote), comparado em tempo constante. Nenhuma credencial real no repositório.
- Interface em português do Brasil. Nenhum emoji em código, commits ou arquivos.
- Fora desta fase: ponte com leitor de código de barras e maquininha, alerta por e-mail ou push, assinatura criptográfica de pacotes, cartão, NFC-e, lote e validade.

## Review Focus

1. Dois heartbeats simultâneos do mesmo totem, ou um heartbeat repetido logo depois: o comando é entregue uma única vez dentro da janela de 2 minutos (Tarefas 2 e 4).
2. Totem offline por dias com um `reboot` esquecido na fila: o comando expira e nunca roda quando o totem volta (Tarefas 2 e 4).
3. Resposta de resultado perdida ou repetida: o `reboot` nunca roda sem confirmação do servidor e nunca entra em laço; o resultado repetido é idempotente (Tarefas 2, 4 e 9).
4. Pacote com hash diferente, sem `main.ts`, corrompido, ou versão com `../`: nada muda no disco e o comando falha com erro visível (Tarefas 3, 4 e 10).
5. Totem revogado, token de outra organização, comando de outro totem, ids e versões malformados: sempre 4xx, nunca 500, e RLS impede o cruzamento entre tenants (Tarefas 1, 2, 4 e 5).
6. Update que deixa o agente mudo: o watchdog volta à versão anterior (Tarefa 10).

---

## Estrutura de arquivos

```
src/db/migrations/0004_agent.sql                 # colunas em terminals, terminal_commands, agent_releases
src/domain/agent.ts                              # heartbeat, entrega atômica, resultado, criação e listagem de comandos, offline
src/domain/terminals.ts                          # + lastHeartbeatAt, agentVersion, pdvStatus, timezone em listTerminals
src/agent/releases.ts                            # ReleaseStore (implementação Postgres) e releaseStore
src/agent/http.ts                                # heartbeatHandler, resultHandler, releaseHandler, publishReleaseHandler
src/pdv/http.ts                                  # exporta handle, bodyOf e entradas novas em STATUS
src/pdv/token.ts                                 # tokenFromHash (token no fragmento da URL)
src/auth/service.ts                              # + userEmails
src/lib/messages.ts, src/lib/labels.ts           # mensagens e rótulos novos
src/app/api/agent/heartbeat/route.ts
src/app/api/agent/commands/[id]/result/route.ts
src/app/api/agent/releases/[version]/route.ts
src/app/api/internal/releases/route.ts
src/app/o/[orgId]/terminals/page.tsx, actions.ts # painel: estado, comandos, histórico
src/app/o/[orgId]/page.tsx                       # contagem de totens offline
src/app/pdv/PdvApp.tsx                           # lê o token do fragmento
agent/package.json                               # {"type":"module"}
agent/config.ts, api.ts, browser.ts, loop.ts, update.ts, main.ts
agent/watchdog.sh, agent/install.sh
scripts/agent-release.ts                         # empacota agent/ e publica
tests/db/agent-schema.test.ts
tests/domain/agent.test.ts
tests/agent-api/releases.test.ts, handlers.test.ts
tests/pdv/token.test.ts
tests/agent/config.test.ts, api.test.ts, browser.test.ts, loop.test.ts, update.test.ts, watchdog.test.ts, scripts.test.ts
```

---

### Task 1: Migration 0004 e helpers de teste

**Files:**
- Create: `src/db/migrations/0004_agent.sql`, `tests/db/agent-schema.test.ts`
- Modify: `tests/helpers.ts` (lista `TABLES`), `vitest.config.ts` (variável `RELEASE_SECRET`), `.env.example`

**Interfaces:**
- Consumes: tabelas `terminals`, `users` das fases 1 e 2; `makeOrg`, `seedStore`, `makeUser`, `resetDb` de `tests/helpers.ts`.
- Produces: colunas `terminals.last_heartbeat_at`, `agent_version`, `pdv_status`; tabelas `terminal_commands` e `agent_releases`; `process.env.RELEASE_SECRET` nos testes.

- [ ] **Step 1: Escrever o teste do esquema (falha)**

Criar `tests/db/agent-schema.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { appSql } from "@/db/client";
import { withOrg } from "@/db/tenant";
import { makeOrg, resetDb, seedStore } from "../helpers";

beforeEach(resetDb);

const insertCommand = (orgId: string, terminalId: string, type = "restart_pdv") =>
  withOrg(orgId, (tx) => tx`
    insert into terminal_commands (org_id, terminal_id, type)
    values (${orgId}, ${terminalId}, ${type}) returning id`);

describe("phase 3 schema", () => {
  it("isolates terminal commands per tenant", async () => {
    const a = await makeOrg("A");
    const b = await makeOrg("B");
    const sa = await seedStore(a);
    const sb = await seedStore(b);
    await insertCommand(a, sa.terminalId);
    await insertCommand(b, sb.terminalId);
    const seen = await withOrg(a, (tx) => tx`select terminal_id from terminal_commands`);
    expect(seen.map((r) => r.terminal_id)).toEqual([sa.terminalId]);
  });

  it("blocks a command that points at another tenant's terminal", async () => {
    const a = await makeOrg("A");
    const b = await makeOrg("B");
    const theirs = await seedStore(b);
    await expect(insertCommand(a, theirs.terminalId)).rejects.toThrow(/foreign key|row-level security/);
  });

  it("allows one open command per type per terminal, and a new one after it finishes", async () => {
    const a = await makeOrg("A");
    const s = await seedStore(a);
    const [first] = await insertCommand(a, s.terminalId);
    await expect(insertCommand(a, s.terminalId)).rejects.toThrow(/unique|duplicate/);
    await insertCommand(a, s.terminalId, "reboot");
    await withOrg(a, (tx) => tx`update terminal_commands set status = 'succeeded' where id = ${first.id}`);
    await expect(insertCommand(a, s.terminalId)).resolves.toBeDefined();
  });

  it("rejects unknown command types and statuses", async () => {
    const a = await makeOrg("A");
    const s = await seedStore(a);
    await expect(insertCommand(a, s.terminalId, "rm_rf")).rejects.toThrow(/check/);
  });

  it("keeps agent_releases away from the application role", async () => {
    await expect(appSql`select version from agent_releases`).rejects.toThrow(/permission denied/);
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `npx vitest run tests/db/agent-schema.test.ts`
Expected: FAIL com `relation "terminal_commands" does not exist` (o `resetDb` ainda não conhece as tabelas e a migration não existe).

- [ ] **Step 3: Criar a migration**

Criar `src/db/migrations/0004_agent.sql`:

```sql
-- Phase 3: totem agent. Heartbeat state on terminals, the remote command queue, and agent packages.
ALTER TABLE terminals
  ADD COLUMN last_heartbeat_at timestamptz,
  ADD COLUMN agent_version text,
  ADD COLUMN pdv_status text CHECK (pdv_status IN ('running', 'stopped'));

CREATE TABLE terminal_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  terminal_id uuid NOT NULL,
  type text NOT NULL CHECK (type IN ('restart_pdv', 'reboot', 'update')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'delivered', 'succeeded', 'failed')),
  created_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  finished_at timestamptz,
  error text,
  UNIQUE (id, org_id),
  FOREIGN KEY (terminal_id, org_id) REFERENCES terminals (id, org_id)
);
CREATE INDEX terminal_commands_terminal_idx ON terminal_commands (terminal_id, created_at DESC);
-- At most one open command of each type per terminal (the panel cannot stack reboots).
CREATE UNIQUE INDEX terminal_commands_open_idx
  ON terminal_commands (terminal_id, type) WHERE status IN ('pending', 'delivered');

ALTER TABLE terminal_commands ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON terminal_commands
  USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE ON terminal_commands TO market77_app;

-- Agent packages are the same for every tenant: no org_id, no RLS, no grant for the application role.
-- Only adminSql (through ReleaseStore) reads or writes them.
CREATE TABLE agent_releases (
  version text PRIMARY KEY,
  sha256 text NOT NULL,
  size_bytes integer NOT NULL CHECK (size_bytes > 0),
  data bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

- [ ] **Step 4: Atualizar helpers, config de teste e `.env.example`**

Em `tests/helpers.ts`, trocar o início da lista `TABLES` por:

```ts
const TABLES = [
  "terminal_commands", "agent_releases",
  "payments", "sale_items", "sales", "terminals",
```

Em `vitest.config.ts`, acrescentar ao objeto `env` (depois de `RECONCILE_SECRET`):

```ts
  RELEASE_SECRET: "test-release-secret",
```

Acrescentar uma linha ao fim de `.env.example`:

```
RELEASE_SECRET=dev-release-secret
```

E acrescentar a mesma linha `RELEASE_SECRET=dev-release-secret` ao `.env` local (arquivo ignorado pelo Git).

- [ ] **Step 5: Rodar o teste e ver passar**

Run: `npx vitest run tests/db/agent-schema.test.ts`
Expected: PASS (5 testes). O `global-setup` aplica a migration no banco de teste.

- [ ] **Step 6: Typecheck e suíte completa**

Run: `npm run typecheck && npm test`
Expected: sem erros; todos os testes passam.

- [ ] **Step 7: Commit**

```bash
git add src/db/migrations/0004_agent.sql tests/db/agent-schema.test.ts tests/helpers.ts vitest.config.ts .env.example
git commit -m "feat: add phase 3 schema for terminal commands and agent releases"
```

---

### Task 2: Domínio dos comandos e do heartbeat

**Files:**
- Create: `src/domain/agent.ts`, `tests/domain/agent.test.ts`
- Modify: `src/domain/terminals.ts`, `src/lib/messages.ts`, `src/auth/service.ts`

**Interfaces:**
- Consumes: `Tx`, `AppError`, `parse`, `createTerminal`, `makeUser`, `makeOrg`, `seedStore`, `codeOf`.
- Produces (todos em `src/domain/agent.ts`):
  - `ONLINE_WINDOW_MS`, `REDELIVER_AFTER_MS`, `COMMAND_TTL_MS`, `VERSION_RE`, `COMMAND_TYPES`, `type CommandType`
  - `isOnline(last: Date | null, now: Date): boolean`
  - `recordHeartbeat(tx: Tx, terminalId: string, raw: unknown, now: Date): Promise<void>`
  - `claimNextCommand(tx: Tx, terminalId: string, now: Date): Promise<ClaimedCommand | null>` com `type ClaimedCommand = { id: string; type: CommandType; payload: { version?: string } }`
  - `finishCommand(tx: Tx, terminalId: string, commandId: string, raw: unknown, now: Date): Promise<void>`
  - `createCommand(tx: Tx, orgId: string, userId: string, raw: unknown, now: Date): Promise<string>`
  - `listCommands(tx: Tx, terminalId: string, limit?: number): Promise<CommandRow[]>`
  - `countOfflineTerminals(tx: Tx, now: Date): Promise<number>`
- Produces em `src/domain/terminals.ts`: `TerminalRow` ganha `lastHeartbeatAt: Date | null`, `agentVersion: string | null`, `pdvStatus: string | null`, `timezone: string`.
- Produces em `src/auth/service.ts`: `userEmails(ids: string[]): Promise<Map<string, string>>`.

- [ ] **Step 1: Escrever os testes (falham)**

Criar `tests/domain/agent.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { adminSql } from "@/db/client";
import { withOrg } from "@/db/tenant";
import {
  COMMAND_TTL_MS, ONLINE_WINDOW_MS, REDELIVER_AFTER_MS, claimNextCommand, countOfflineTerminals,
  createCommand, finishCommand, isOnline, listCommands, recordHeartbeat,
} from "@/domain/agent";
import { createTerminal, listTerminals, revokeTerminal } from "@/domain/terminals";
import { codeOf, makeOrg, makeUser, resetDb, seedStore } from "../helpers";

beforeEach(resetDb);

const at = (ms: number) => new Date(Date.now() + ms);

async function setup() {
  const orgId = await makeOrg("A");
  const userId = await makeUser(`u${Math.random()}@x.com`);
  const { marketId } = await seedStore(orgId);
  const { id: terminalId } = await withOrg(orgId, (tx) =>
    createTerminal(tx, orgId, { marketId, name: "Totem 1" }),
  );
  const send = (type: string, version?: string) =>
    withOrg(orgId, (tx) => createCommand(tx, orgId, userId, { terminalId, type, version }, new Date()));
  const claim = (now = new Date()) => withOrg(orgId, (tx) => claimNextCommand(tx, terminalId, now));
  return { orgId, userId, marketId, terminalId, send, claim };
}

describe("heartbeat and online state", () => {
  it("stores the heartbeat and shows it in the terminal list", async () => {
    const s = await setup();
    const now = new Date();
    await withOrg(s.orgId, (tx) =>
      recordHeartbeat(tx, s.terminalId, { agentVersion: "1.0.0", pdvStatus: "running" }, now),
    );
    const [t] = await withOrg(s.orgId, (tx) => listTerminals(tx));
    expect([t.agentVersion, t.pdvStatus, t.lastHeartbeatAt?.getTime()]).toEqual(["1.0.0", "running", now.getTime()]);
    expect(t.timezone).toBeTruthy();
  });

  it("rejects a bad heartbeat body", async () => {
    const s = await setup();
    const bad = [{}, { agentVersion: "", pdvStatus: "running" }, { agentVersion: "1.0.0", pdvStatus: "weird" }, null];
    for (const raw of bad) {
      expect(await codeOf(withOrg(s.orgId, (tx) => recordHeartbeat(tx, s.terminalId, raw, new Date())))).toBe("invalid_input");
    }
  });

  it("is online up to 2 minutes after the last heartbeat and never connected is not online", () => {
    const now = new Date("2026-10-03T12:00:00Z");
    expect(isOnline(null, now)).toBe(false);
    expect(isOnline(new Date(now.getTime() - ONLINE_WINDOW_MS), now)).toBe(true);
    expect(isOnline(new Date(now.getTime() - ONLINE_WINDOW_MS - 1), now)).toBe(false);
  });

  it("counts only terminals that connected before and went quiet, ignoring revoked ones", async () => {
    const s = await setup();
    const now = new Date();
    const mk = (name: string) =>
      withOrg(s.orgId, (tx) => createTerminal(tx, s.orgId, { marketId: s.marketId, name }));
    const quiet = await mk("Quieto");
    const live = await mk("Vivo");
    const gone = await mk("Revogado");
    await mk("Nunca");
    const beat = (id: string, when: Date) =>
      withOrg(s.orgId, (tx) => recordHeartbeat(tx, id, { agentVersion: "1.0.0", pdvStatus: "running" }, when));
    await beat(quiet.id, new Date(now.getTime() - ONLINE_WINDOW_MS - 1000));
    await beat(live.id, now);
    await beat(gone.id, new Date(now.getTime() - ONLINE_WINDOW_MS - 1000));
    await withOrg(s.orgId, (tx) => revokeTerminal(tx, gone.id));
    expect(await withOrg(s.orgId, (tx) => countOfflineTerminals(tx, now))).toBe(1);
  });
});

describe("command delivery", () => {
  it("delivers the oldest pending command once and nothing else while it waits for a result", async () => {
    const s = await setup();
    await s.send("restart_pdv");
    await s.send("reboot");
    const first = await s.claim();
    expect(first?.type).toBe("restart_pdv");
    expect(await s.claim()).toBeNull();
    expect(await s.claim(at(REDELIVER_AFTER_MS - 5000))).toBeNull();
  });

  it("redelivers a delivered command that got no result after 2 minutes", async () => {
    const s = await setup();
    await s.send("reboot");
    const first = await s.claim();
    const again = await s.claim(at(REDELIVER_AFTER_MS + 5000));
    expect(again?.id).toBe(first?.id);
  });

  it("serves the next command after the first one finishes", async () => {
    const s = await setup();
    await s.send("restart_pdv");
    await s.send("reboot");
    const first = await s.claim();
    await withOrg(s.orgId, (tx) => finishCommand(tx, s.terminalId, first!.id, { ok: true }, new Date()));
    expect((await s.claim())?.type).toBe("reboot");
  });

  it("delivers to exactly one of several simultaneous heartbeats", async () => {
    const s = await setup();
    await s.send("reboot");
    const beat = () =>
      withOrg(s.orgId, async (tx) => {
        const now = new Date();
        await recordHeartbeat(tx, s.terminalId, { agentVersion: "1.0.0", pdvStatus: "running" }, now);
        return claimNextCommand(tx, s.terminalId, now);
      });
    const got = await Promise.all([beat(), beat(), beat(), beat(), beat()]);
    expect(got.filter((c) => c !== null)).toHaveLength(1);
  });

  it("expires old commands instead of delivering them", async () => {
    const s = await setup();
    const [row] = await withOrg(s.orgId, (tx) => tx`
      insert into terminal_commands (org_id, terminal_id, type, created_at)
      values (${s.orgId}, ${s.terminalId}, 'reboot', now() - interval '11 minutes') returning id`);
    expect(await s.claim()).toBeNull();
    const [after] = await adminSql`select status, error from terminal_commands where id = ${row.id}`;
    expect([after.status, after.error]).toEqual(["failed", "expired"]);
    expect(COMMAND_TTL_MS).toBe(600_000);
  });

  it("carries the version of an update in the payload", async () => {
    const s = await setup();
    await s.send("update", "1.2.3");
    expect((await s.claim())?.payload).toEqual({ version: "1.2.3" });
  });
});

describe("command results", () => {
  it("closes a delivered command, is idempotent and keeps the first outcome", async () => {
    const s = await setup();
    await s.send("restart_pdv");
    const cmd = await s.claim();
    const finish = (raw: unknown) =>
      withOrg(s.orgId, (tx) => finishCommand(tx, s.terminalId, cmd!.id, raw, new Date()));
    await finish({ ok: false, error: "chromium_failed" });
    await finish({ ok: true });
    const [row] = await withOrg(s.orgId, (tx) => listCommands(tx, s.terminalId));
    expect([row.status, row.error]).toEqual(["failed", "chromium_failed"]);
  });

  it("answers not_found for another terminal's command and for malformed ids", async () => {
    const s = await setup();
    const other = await withOrg(s.orgId, (tx) =>
      createTerminal(tx, s.orgId, { marketId: s.marketId, name: "Outro" }),
    );
    await s.send("reboot");
    const cmd = await s.claim();
    const fin = (terminalId: string, id: string) =>
      withOrg(s.orgId, (tx) => finishCommand(tx, terminalId, id, { ok: true }, new Date()));
    expect(await codeOf(fin(other.id, cmd!.id))).toBe("not_found");
    expect(await codeOf(fin(s.terminalId, "nope"))).toBe("not_found");
    expect(await codeOf(withOrg(s.orgId, (tx) => finishCommand(tx, s.terminalId, cmd!.id, { ok: "yes" }, new Date())))).toBe("invalid_input");
  });
});

describe("creating commands", () => {
  it("refuses a second open command of the same type and accepts it after expiry", async () => {
    const s = await setup();
    await s.send("reboot");
    expect(await codeOf(s.send("reboot"))).toBe("command_in_progress");
    await s.send("restart_pdv");
    await adminSql`update terminal_commands set created_at = now() - interval '11 minutes' where type = 'reboot'`;
    await expect(s.send("reboot")).resolves.toBeDefined();
  });

  it("validates input, the terminal and the update version", async () => {
    const s = await setup();
    expect(await codeOf(s.send("format_disk"))).toBe("invalid_input");
    expect(await codeOf(s.send("update"))).toBe("invalid_input");
    expect(await codeOf(s.send("update", "../etc"))).toBe("invalid_input");
    const bad = (terminalId: string) =>
      withOrg(s.orgId, (tx) => createCommand(tx, s.orgId, s.userId, { terminalId, type: "reboot" }, new Date()));
    expect(await codeOf(bad("nope"))).toBe("invalid_input");
    expect(await codeOf(bad("00000000-0000-0000-0000-000000000000"))).toBe("not_found");
    await withOrg(s.orgId, (tx) => revokeTerminal(tx, s.terminalId));
    expect(await codeOf(s.send("reboot"))).toBe("terminal_revoked");
  });

  it("does not let tenant B command tenant A's terminal", async () => {
    const a = await setup();
    const orgB = await makeOrg("B");
    const code = await codeOf(
      withOrg(orgB, (tx) =>
        createCommand(tx, orgB, a.userId, { terminalId: a.terminalId, type: "reboot" }, new Date())),
    );
    expect(code).toBe("not_found");
  });

  it("lists the latest commands first and caps the list", async () => {
    const s = await setup();
    await s.send("restart_pdv");
    await s.send("reboot");
    const list = await withOrg(s.orgId, (tx) => listCommands(tx, s.terminalId, 1));
    expect(list.map((c) => c.type)).toEqual(["reboot"]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/domain/agent.test.ts`
Expected: FAIL com `Cannot find module '@/domain/agent'`.

- [ ] **Step 3: Estender `listTerminals` e `TerminalRow`**

Em `src/domain/terminals.ts`, trocar o tipo `TerminalRow` e a função `listTerminals` por:

```ts
export type TerminalRow = {
  id: string;
  marketId: string;
  marketName: string;
  timezone: string;
  name: string;
  createdAt: Date;
  revokedAt: Date | null;
  lastHeartbeatAt: Date | null;
  agentVersion: string | null;
  pdvStatus: string | null;
};
```

```ts
export async function listTerminals(tx: Tx): Promise<TerminalRow[]> {
  const rows = await tx`
    select t.id, t.market_id, m.name as market_name, m.timezone, t.name, t.created_at, t.revoked_at,
           t.last_heartbeat_at, t.agent_version, t.pdv_status
    from terminals t join markets m on m.id = t.market_id
    order by t.created_at desc`;
  return rows.map((r) => ({
    id: r.id as string,
    marketId: r.market_id as string,
    marketName: r.market_name as string,
    timezone: r.timezone as string,
    name: r.name as string,
    createdAt: r.created_at as Date,
    revokedAt: (r.revoked_at as Date | null) ?? null,
    lastHeartbeatAt: (r.last_heartbeat_at as Date | null) ?? null,
    agentVersion: (r.agent_version as string | null) ?? null,
    pdvStatus: (r.pdv_status as string | null) ?? null,
  }));
}
```

- [ ] **Step 4: Mensagens e `userEmails`**

Em `src/lib/messages.ts`, acrescentar ao objeto `MESSAGES` (depois de `payment_failed`):

```ts
  command_in_progress: "Já existe um comando deste tipo em andamento para este totem.",
  release_not_found: "Versão do agente não encontrada.",
  release_exists: "Esta versão do agente já foi publicada.",
  release_too_large: "O pacote do agente passou do limite de 20 MB.",
```

Ao fim de `src/auth/service.ts` (que já importa `adminSql`), acrescentar:

```ts
/** E-mails por id de usuário, para telas que mostram quem fez algo. A aplicação não lê `users` por RLS. */
export async function userEmails(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await adminSql`select id, email from users where id in ${adminSql(unique)}`;
  return new Map(rows.map((r) => [r.id as string, r.email as string]));
}
```

- [ ] **Step 5: Implementar `src/domain/agent.ts`**

```ts
import { z } from "zod";
import type { Tx } from "@/db/tenant";
import { AppError } from "@/lib/errors";
import { parse } from "@/lib/validate";

export const ONLINE_WINDOW_MS = 120_000;
export const REDELIVER_AFTER_MS = 120_000;
export const COMMAND_TTL_MS = 600_000;
export const VERSION_RE = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
export const COMMAND_TYPES = ["restart_pdv", "reboot", "update"] as const;
export type CommandType = (typeof COMMAND_TYPES)[number];

export type ClaimedCommand = { id: string; type: CommandType; payload: { version?: string } };
export type CommandRow = {
  id: string;
  type: CommandType;
  status: string;
  createdBy: string | null;
  createdAt: Date;
  error: string | null;
};

export const isOnline = (last: Date | null, now: Date): boolean =>
  last !== null && now.getTime() - last.getTime() <= ONLINE_WINDOW_MS;

const Heartbeat = z.object({
  agentVersion: z.string().trim().min(1).max(40),
  pdvStatus: z.enum(["running", "stopped"]),
});

/** The update takes a row lock on the terminal, so concurrent heartbeats of one terminal run one after the other. */
export async function recordHeartbeat(tx: Tx, terminalId: string, raw: unknown, now: Date): Promise<void> {
  const i = parse(Heartbeat, raw);
  await tx`
    update terminals
    set last_heartbeat_at = ${now}, agent_version = ${i.agentVersion}, pdv_status = ${i.pdvStatus}
    where id = ${terminalId}`;
}

async function expireStaleCommands(tx: Tx, terminalId: string, now: Date): Promise<void> {
  const oldest = new Date(now.getTime() - COMMAND_TTL_MS);
  await tx`
    update terminal_commands
    set status = 'failed', error = 'expired', finished_at = ${now}
    where terminal_id = ${terminalId} and status in ('pending', 'delivered') and created_at < ${oldest}`;
}

/**
 * Hands out at most one command: the oldest pending one, or a delivered one that got no result for
 * REDELIVER_AFTER_MS. Nothing is handed out while another command is still waiting for its result.
 * Call it in the same transaction as recordHeartbeat so the terminal row lock serializes callers.
 */
export async function claimNextCommand(tx: Tx, terminalId: string, now: Date): Promise<ClaimedCommand | null> {
  await expireStaleCommands(tx, terminalId, now);
  const redeliverBefore = new Date(now.getTime() - REDELIVER_AFTER_MS);
  const [row] = await tx`
    update terminal_commands set status = 'delivered', delivered_at = ${now}
    where id = (
      select c.id from terminal_commands c
      where c.terminal_id = ${terminalId}
        and (c.status = 'pending' or (c.status = 'delivered' and c.delivered_at < ${redeliverBefore}))
        and not exists (
          select 1 from terminal_commands d
          where d.terminal_id = ${terminalId} and d.status = 'delivered' and d.delivered_at >= ${redeliverBefore})
      order by c.created_at, c.id
      limit 1)
    returning id, type, payload`;
  if (!row) return null;
  return { id: row.id as string, type: row.type as CommandType, payload: (row.payload ?? {}) as { version?: string } };
}

const Result = z.object({ ok: z.boolean(), error: z.string().max(500).optional() });
const isUuid = (s: string) => z.string().uuid().safeParse(s).success;

/** Idempotent: a command that already has an outcome keeps it. Another terminal's command is not_found. */
export async function finishCommand(
  tx: Tx,
  terminalId: string,
  commandId: string,
  raw: unknown,
  now: Date,
): Promise<void> {
  if (!isUuid(commandId)) throw new AppError("not_found");
  const r = parse(Result, raw);
  const [done] = await tx`
    update terminal_commands
    set status = ${r.ok ? "succeeded" : "failed"}, finished_at = ${now}, error = ${r.ok ? null : (r.error ?? "unknown")}
    where id = ${commandId} and terminal_id = ${terminalId} and status = 'delivered'
    returning id`;
  if (done) return;
  const [known] = await tx`select 1 as x from terminal_commands where id = ${commandId} and terminal_id = ${terminalId}`;
  if (!known) throw new AppError("not_found");
}

const Create = z
  .object({
    terminalId: z.string().uuid(),
    type: z.enum(COMMAND_TYPES),
    version: z.string().regex(VERSION_RE).optional(),
  })
  .refine((i) => i.type !== "update" || i.version !== undefined, { message: "version required" });

export async function createCommand(
  tx: Tx,
  orgId: string,
  userId: string,
  raw: unknown,
  now: Date,
): Promise<string> {
  const i = parse(Create, raw);
  const [t] = await tx`select revoked_at from terminals where id = ${i.terminalId}`;
  if (!t) throw new AppError("not_found");
  if (t.revoked_at) throw new AppError("terminal_revoked");
  await expireStaleCommands(tx, i.terminalId, now);
  const payload = i.type === "update" ? { version: i.version } : {};
  // ON CONFLICT instead of catching the unique violation: an error would abort the transaction and undo the expiry above.
  const [row] = await tx`
    insert into terminal_commands (org_id, terminal_id, type, payload, created_by)
    values (${orgId}, ${i.terminalId}, ${i.type}, ${tx.json(payload)}, ${userId})
    on conflict (terminal_id, type) where status in ('pending', 'delivered') do nothing
    returning id`;
  if (!row) throw new AppError("command_in_progress");
  return row.id as string;
}

export async function listCommands(tx: Tx, terminalId: string, limit = 5): Promise<CommandRow[]> {
  const rows = await tx`
    select id, type, status, created_by, created_at, error
    from terminal_commands where terminal_id = ${terminalId}
    order by created_at desc, id desc limit ${limit}`;
  return rows.map((r) => ({
    id: r.id as string,
    type: r.type as CommandType,
    status: r.status as string,
    createdBy: (r.created_by as string | null) ?? null,
    createdAt: r.created_at as Date,
    error: (r.error as string | null) ?? null,
  }));
}

/** Terminals that connected before and went quiet. Never-connected and revoked terminals do not count. */
export async function countOfflineTerminals(tx: Tx, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - ONLINE_WINDOW_MS);
  const [r] = await tx`
    select count(*)::int as n from terminals
    where revoked_at is null and last_heartbeat_at is not null and last_heartbeat_at < ${cutoff}`;
  return r.n as number;
}
```

- [ ] **Step 6: Rodar os testes**

Run: `npx vitest run tests/domain/agent.test.ts`
Expected: PASS. Se `tx.json(payload)` reclamar de tipo no `tsc`, trocar por `${JSON.stringify(payload)}::jsonb`.

- [ ] **Step 7: Typecheck e suíte completa**

Run: `npm run typecheck && npm test`
Expected: sem erros; os testes antigos de `listTerminals` seguem passando.

- [ ] **Step 8: Commit**

```bash
git add src/domain/agent.ts src/domain/terminals.ts src/lib/messages.ts src/auth/service.ts tests/domain/agent.test.ts
git commit -m "feat: add terminal command queue, heartbeat state and offline count"
```

---

### Task 3: ReleaseStore e publicação do pacote

**Files:**
- Create: `src/agent/releases.ts`, `src/agent/http.ts`, `src/app/api/internal/releases/route.ts`, `tests/agent-api/releases.test.ts`
- Modify: `src/pdv/http.ts` (exportar `handle` e `bodyOf`; entradas novas em `STATUS`)

**Interfaces:**
- Consumes: `adminSql`, `AppError`, `VERSION_RE` (`@/domain/agent`), `errorResponse` (`@/pdv/http`).
- Produces:
  - `src/agent/releases.ts`: `MAX_RELEASE_BYTES`, `type ReleaseMeta = { version: string; sha256: string; sizeBytes: number; createdAt: Date }`, `interface ReleaseStore { put(version: string, data: Buffer): Promise<ReleaseMeta>; get(version: string): Promise<{ meta: ReleaseMeta; data: Buffer } | null>; meta(version: string): Promise<ReleaseMeta | null>; latest(): Promise<ReleaseMeta | null> }`, `pgReleaseStore`, `releaseStore` (o único ponto a trocar por outro armazenamento).
  - `src/agent/http.ts`: `publishReleaseHandler(req: Request): Promise<Response>`.
  - `src/pdv/http.ts`: `handle` e `bodyOf` exportados; `STATUS` com `command_in_progress: 409`, `release_not_found: 404`, `release_exists: 409`, `release_too_large: 413`.

- [ ] **Step 1: Escrever os testes (falham)**

Criar `tests/agent-api/releases.test.ts`:

```ts
import { gzipSync } from "node:zlib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_RELEASE_BYTES, releaseStore } from "@/agent/releases";
import { publishReleaseHandler } from "@/agent/http";
import { codeOf, resetDb } from "../helpers";

beforeEach(resetDb);

const pkg = (text = "agent") => gzipSync(Buffer.from(text));

describe("release store", () => {
  it("stores a package, returns its hash and reads it back byte for byte", async () => {
    const data = pkg("v1");
    const meta = await releaseStore.put("1.0.0", data);
    expect(meta.sha256).toMatch(/^[0-9a-f]{64}$/);
    const got = await releaseStore.get("1.0.0");
    expect(got?.data.equals(data)).toBe(true);
    expect(got?.meta.sizeBytes).toBe(data.length);
  });

  it("refuses a repeated version, bad versions, non-gzip data and oversized data", async () => {
    await releaseStore.put("1.0.0", pkg());
    expect(await codeOf(releaseStore.put("1.0.0", pkg("other")))).toBe("release_exists");
    for (const v of ["", "1.0", "../1.0.0", "1.0.0-beta", "latest"]) {
      expect(await codeOf(releaseStore.put(v, pkg()))).toBe("invalid_input");
    }
    expect(await codeOf(releaseStore.put("1.0.1", Buffer.from("not gzip")))).toBe("invalid_input");
    const big = Buffer.alloc(MAX_RELEASE_BYTES + 1);
    big[0] = 0x1f;
    big[1] = 0x8b;
    expect(await codeOf(releaseStore.put("1.0.2", big))).toBe("release_too_large");
  });

  it("returns null for unknown versions and the most recently published one as latest", async () => {
    expect(await releaseStore.get("9.9.9")).toBeNull();
    expect(await releaseStore.latest()).toBeNull();
    await releaseStore.put("1.0.0", pkg("a"));
    await releaseStore.put("0.9.0", pkg("b"));
    expect((await releaseStore.latest())?.version).toBe("0.9.0");
  });
});

describe("publish route handler", () => {
  const call = (secret: string | undefined, version: string | undefined, body: Buffer) =>
    publishReleaseHandler(
      new Request("http://m77.test/api/internal/releases", {
        method: "POST",
        headers: {
          ...(secret ? { "x-release-secret": secret } : {}),
          ...(version ? { "x-version": version } : {}),
        },
        body: new Uint8Array(body),
      }),
    );

  it("is a 404 without a configured secret, 401 with a wrong one and 201 with the right one", async () => {
    vi.stubEnv("RELEASE_SECRET", "");
    expect((await call("x", "1.0.0", pkg())).status).toBe(404);
    vi.unstubAllEnvs();
    expect((await call(undefined, "1.0.0", pkg())).status).toBe(401);
    expect((await call("wrong", "1.0.0", pkg())).status).toBe(401);
    const ok = await call("test-release-secret", "1.0.0", pkg());
    expect(ok.status).toBe(201);
    expect(Object.keys(await ok.json()).sort()).toEqual(["sha256", "sizeBytes", "version"]);
  });

  it("answers 409 for a repeated version, 400 for a bad one and 413 for an oversized body", async () => {
    await call("test-release-secret", "1.0.0", pkg());
    expect((await call("test-release-secret", "1.0.0", pkg("x"))).status).toBe(409);
    expect((await call("test-release-secret", "oops", pkg())).status).toBe(400);
    expect((await call("test-release-secret", undefined, pkg())).status).toBe(400);
    const big = Buffer.alloc(MAX_RELEASE_BYTES + 1);
    big[0] = 0x1f;
    big[1] = 0x8b;
    expect((await call("test-release-secret", "1.0.5", big)).status).toBe(413);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/agent-api/releases.test.ts`
Expected: FAIL com `Cannot find module '@/agent/releases'`.

- [ ] **Step 3: Ajustar `src/pdv/http.ts`**

Acrescentar quatro entradas ao fim do objeto `STATUS`:

```ts
  command_in_progress: 409,
  release_not_found: 404,
  release_exists: 409,
  release_too_large: 413,
```

Trocar `async function handle(` por `export async function handle(` e `async function bodyOf(` por `export async function bodyOf(`.

- [ ] **Step 4: Implementar `src/agent/releases.ts`**

```ts
import { createHash } from "node:crypto";
import { adminSql } from "@/db/client";
import { VERSION_RE } from "@/domain/agent";
import { AppError } from "@/lib/errors";

export const MAX_RELEASE_BYTES = 20 * 1024 * 1024;

export type ReleaseMeta = { version: string; sha256: string; sizeBytes: number; createdAt: Date };

/** Where agent packages live. Phase 3 keeps them in Postgres; swap `releaseStore` for an object store if packages grow. */
export interface ReleaseStore {
  put(version: string, data: Buffer): Promise<ReleaseMeta>;
  get(version: string): Promise<{ meta: ReleaseMeta; data: Buffer } | null>;
  meta(version: string): Promise<ReleaseMeta | null>;
  latest(): Promise<ReleaseMeta | null>;
}

const toMeta = (r: Record<string, unknown>): ReleaseMeta => ({
  version: r.version as string,
  sha256: r.sha256 as string,
  sizeBytes: r.size_bytes as number,
  createdAt: r.created_at as Date,
});

export const pgReleaseStore: ReleaseStore = {
  async put(version, data) {
    if (!VERSION_RE.test(version)) throw new AppError("invalid_input");
    if (data.length < 2 || data[0] !== 0x1f || data[1] !== 0x8b) throw new AppError("invalid_input");
    if (data.length > MAX_RELEASE_BYTES) throw new AppError("release_too_large");
    const sha256 = createHash("sha256").update(data).digest("hex");
    const rows = await adminSql`
      insert into agent_releases (version, sha256, size_bytes, data)
      values (${version}, ${sha256}, ${data.length}, ${data})
      on conflict (version) do nothing
      returning version, sha256, size_bytes, created_at`;
    if (rows.length === 0) throw new AppError("release_exists");
    return toMeta(rows[0]);
  },
  async get(version) {
    if (!VERSION_RE.test(version)) return null;
    const [r] = await adminSql`
      select version, sha256, size_bytes, created_at, data from agent_releases where version = ${version}`;
    return r ? { meta: toMeta(r), data: Buffer.from(r.data as Buffer) } : null;
  },
  async meta(version) {
    if (!VERSION_RE.test(version)) return null;
    const [r] = await adminSql`
      select version, sha256, size_bytes, created_at from agent_releases where version = ${version}`;
    return r ? toMeta(r) : null;
  },
  async latest() {
    const [r] = await adminSql`
      select version, sha256, size_bytes, created_at from agent_releases order by created_at desc limit 1`;
    return r ? toMeta(r) : null;
  },
};

export const releaseStore: ReleaseStore = pgReleaseStore;
```

- [ ] **Step 5: Implementar `publishReleaseHandler` em `src/agent/http.ts`**

```ts
import { timingSafeEqual } from "node:crypto";
import { AppError } from "@/lib/errors";
import { errorResponse } from "@/pdv/http";
import { MAX_RELEASE_BYTES, releaseStore } from "./releases";

function secretMatches(given: string | null, expected: string): boolean {
  const a = Buffer.from(given ?? "");
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Called by `npm run agent:release`. Disabled unless RELEASE_SECRET is set. */
export async function publishReleaseHandler(req: Request): Promise<Response> {
  const secret = process.env.RELEASE_SECRET;
  if (!secret) return new Response(null, { status: 404 });
  if (!secretMatches(req.headers.get("x-release-secret"), secret)) return new Response(null, { status: 401 });
  try {
    if (Number(req.headers.get("content-length") ?? 0) > MAX_RELEASE_BYTES) throw new AppError("release_too_large");
    const data = Buffer.from(await req.arrayBuffer());
    const meta = await releaseStore.put(req.headers.get("x-version") ?? "", data);
    return Response.json({ version: meta.version, sha256: meta.sha256, sizeBytes: meta.sizeBytes }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
```

- [ ] **Step 6: Criar a rota**

`src/app/api/internal/releases/route.ts`:

```ts
import { publishReleaseHandler } from "@/agent/http";

export const POST = (req: Request) => publishReleaseHandler(req);
```

- [ ] **Step 7: Rodar os testes, typecheck e suíte**

Run: `npx vitest run tests/agent-api/releases.test.ts && npm run typecheck && npm test`
Expected: PASS e sem erros de tipo.

- [ ] **Step 8: Commit**

```bash
git add src/agent src/app/api/internal/releases src/pdv/http.ts tests/agent-api/releases.test.ts
git commit -m "feat: add ReleaseStore on Postgres and the release publish route"
```

---

### Task 4: API do agente (heartbeat, resultado, download)

**Files:**
- Modify: `src/agent/http.ts`
- Create: `src/app/api/agent/heartbeat/route.ts`, `src/app/api/agent/commands/[id]/result/route.ts`, `src/app/api/agent/releases/[version]/route.ts`, `tests/agent-api/handlers.test.ts`

**Interfaces:**
- Consumes: `handle`, `bodyOf`, `errorResponse` (`@/pdv/http`), `requireTerminal` (`@/pdv/auth`), `recordHeartbeat`, `claimNextCommand`, `finishCommand`, `createCommand` (`@/domain/agent`), `releaseStore` (`@/agent/releases`), `createTerminal`, `revokeTerminal`.
- Produces (em `src/agent/http.ts`):
  - `heartbeatHandler(req: Request, now?: Date): Promise<Response>` responde `{ command: null | { id: string; type: "restart_pdv" | "reboot" | "update"; version?: string; sha256?: string } }`
  - `resultHandler(req: Request, commandId: string, now?: Date): Promise<Response>` responde `{ ok: true }`
  - `releaseHandler(req: Request, version: string): Promise<Response>` responde o gzip com o cabeçalho `x-sha256`
- Contrato que o agente (Tarefas 7 a 11) consome: `POST /api/agent/heartbeat` com `{ agentVersion, pdvStatus }`; `POST /api/agent/commands/:id/result` com `{ ok, error? }`; `GET /api/agent/releases/:version`.

- [ ] **Step 1: Escrever os testes (falham)**

Criar `tests/agent-api/handlers.test.ts`:

```ts
import { gzipSync } from "node:zlib";
import { beforeEach, describe, expect, it } from "vitest";
import { heartbeatHandler, releaseHandler, resultHandler } from "@/agent/http";
import { releaseStore } from "@/agent/releases";
import { adminSql } from "@/db/client";
import { withOrg } from "@/db/tenant";
import { REDELIVER_AFTER_MS, createCommand, listCommands } from "@/domain/agent";
import { createTerminal, listTerminals, revokeTerminal } from "@/domain/terminals";
import { makeOrg, makeUser, resetDb, seedStore } from "../helpers";

beforeEach(resetDb);

const BEAT = { agentVersion: "1.0.0", pdvStatus: "running" };
const json = async (r: Response) => (await r.json()) as Record<string, any>;

const post = (token: string | undefined, body?: unknown, raw?: string) =>
  new Request("http://m77.test/api/agent/x", {
    method: "POST",
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });

async function setup() {
  const orgId = await makeOrg("A");
  const userId = await makeUser(`u${Math.random()}@x.com`);
  const { marketId } = await seedStore(orgId);
  const mk = (name: string) => withOrg(orgId, (tx) => createTerminal(tx, orgId, { marketId, name }));
  const first = await mk("Totem 1");
  const send = (terminalId: string, type: string, version?: string) =>
    withOrg(orgId, (tx) => createCommand(tx, orgId, userId, { terminalId, type, version }, new Date()));
  return { orgId, userId, marketId, mk, send, terminalId: first.id, token: first.token };
}
type Setup = Awaited<ReturnType<typeof setup>>;
const beat = (s: Setup, now?: Date) => heartbeatHandler(post(s.token, BEAT), now);

describe("agent authentication", () => {
  it("answers 401 without a token and terminal_revoked for a revoked terminal, on every route", async () => {
    const s = await setup();
    expect((await heartbeatHandler(post(undefined, BEAT))).status).toBe(401);
    expect((await resultHandler(post(undefined, { ok: true }), "x")).status).toBe(401);
    expect((await releaseHandler(post(undefined), "1.0.0")).status).toBe(401);
    await withOrg(s.orgId, (tx) => revokeTerminal(tx, s.terminalId));
    for (const res of [
      await heartbeatHandler(post(s.token, BEAT)),
      await resultHandler(post(s.token, { ok: true }), "x"),
      await releaseHandler(post(s.token), "1.0.0"),
    ]) {
      expect([res.status, (await json(res)).error]).toEqual([401, "terminal_revoked"]);
    }
  });
});

describe("heartbeat", () => {
  it("records the state and answers with no command", async () => {
    const s = await setup();
    const res = await beat(s);
    expect([res.status, await json(res)]).toEqual([200, { command: null }]);
    const [t] = await withOrg(s.orgId, (tx) => listTerminals(tx));
    expect([t.agentVersion, t.pdvStatus, t.lastHeartbeatAt === null]).toEqual(["1.0.0", "running", false]);
  });

  it("answers 400 to a bad body and to broken JSON, never 500", async () => {
    const s = await setup();
    expect((await heartbeatHandler(post(s.token, { agentVersion: "1.0.0" }))).status).toBe(400);
    expect((await heartbeatHandler(post(s.token, undefined, "{"))).status).toBe(400);
    expect((await heartbeatHandler(post(s.token, undefined, "null"))).status).toBe(400);
  });

  it("delivers a command once and redelivers it only after 2 minutes without a result", async () => {
    const s = await setup();
    await s.send(s.terminalId, "restart_pdv");
    const first = (await json(await beat(s))).command;
    expect(first.type).toBe("restart_pdv");
    expect((await json(await beat(s))).command).toBeNull();
    const later = new Date(Date.now() + REDELIVER_AFTER_MS + 5000);
    expect((await json(await beat(s, later))).command.id).toBe(first.id);
  });

  it("delivers to exactly one of several simultaneous heartbeats", async () => {
    const s = await setup();
    await s.send(s.terminalId, "reboot");
    const got = await Promise.all([1, 2, 3, 4, 5].map(async () => (await json(await beat(s))).command));
    expect(got.filter((c) => c !== null)).toHaveLength(1);
  });

  it("does not deliver another terminal's command", async () => {
    const s = await setup();
    const other = await s.mk("Outro");
    await s.send(other.id, "reboot");
    expect((await json(await beat(s))).command).toBeNull();
  });

  it("never delivers a command that sat in the queue for more than 10 minutes", async () => {
    const s = await setup();
    await withOrg(s.orgId, (tx) => tx`
      insert into terminal_commands (org_id, terminal_id, type, created_at)
      values (${s.orgId}, ${s.terminalId}, 'reboot', now() - interval '11 minutes')`);
    expect((await json(await beat(s))).command).toBeNull();
    const [row] = await withOrg(s.orgId, (tx) => listCommands(tx, s.terminalId));
    expect([row.status, row.error]).toEqual(["failed", "expired"]);
  });

  it("gives an update command its version and package hash", async () => {
    const s = await setup();
    const meta = await releaseStore.put("1.2.3", gzipSync(Buffer.from("pkg")));
    await s.send(s.terminalId, "update", "1.2.3");
    const cmd = (await json(await beat(s))).command;
    expect(cmd).toMatchObject({ type: "update", version: "1.2.3", sha256: meta.sha256 });
  });

  it("fails an update whose package does not exist and answers with no command", async () => {
    const s = await setup();
    await s.send(s.terminalId, "update", "9.9.9");
    expect((await json(await beat(s))).command).toBeNull();
    const [row] = await withOrg(s.orgId, (tx) => listCommands(tx, s.terminalId));
    expect([row.status, row.error]).toEqual(["failed", "release_not_found"]);
  });
});

describe("command result", () => {
  async function delivered(s: Setup) {
    await s.send(s.terminalId, "reboot");
    return (await json(await beat(s))).command.id as string;
  }

  it("closes the command and is idempotent", async () => {
    const s = await setup();
    const id = await delivered(s);
    const first = await resultHandler(post(s.token, { ok: true }), id);
    expect([first.status, await json(first)]).toEqual([200, { ok: true }]);
    const again = await resultHandler(post(s.token, { ok: false, error: "late" }), id);
    expect(again.status).toBe(200);
    const [row] = await withOrg(s.orgId, (tx) => listCommands(tx, s.terminalId));
    expect([row.status, row.error]).toEqual(["succeeded", null]);
  });

  it("answers 404 for another terminal's command and for malformed ids, 400 for a bad body", async () => {
    const s = await setup();
    const id = await delivered(s);
    const other = await s.mk("Outro");
    expect((await resultHandler(post(other.token, { ok: true }), id)).status).toBe(404);
    expect((await resultHandler(post(s.token, { ok: true }), "nope")).status).toBe(404);
    expect((await resultHandler(post(s.token, { ok: "yes" }), id)).status).toBe(400);
    expect((await resultHandler(post(s.token, undefined, "{"), id)).status).toBe(400);
  });
});

describe("release download", () => {
  const get = (token: string) => new Request("http://m77.test/x", { headers: { authorization: `Bearer ${token}` } });

  it("serves the package bytes with its SHA-256", async () => {
    const s = await setup();
    const data = gzipSync(Buffer.from("pkg"));
    const meta = await releaseStore.put("1.0.0", data);
    const res = await releaseHandler(get(s.token), "1.0.0");
    expect(res.status).toBe(200);
    expect(res.headers.get("x-sha256")).toBe(meta.sha256);
    expect(Buffer.from(await res.arrayBuffer()).equals(data)).toBe(true);
  });

  it("answers 404 for unknown and malformed versions", async () => {
    const s = await setup();
    expect((await releaseHandler(get(s.token), "9.9.9")).status).toBe(404);
    expect((await releaseHandler(get(s.token), "../x")).status).toBe(404);
    expect((await releaseHandler(get(s.token), "latest")).status).toBe(404);
    const [{ n }] = await adminSql`select count(*)::int as n from agent_releases`;
    expect(n).toBe(0);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/agent-api/handlers.test.ts`
Expected: FAIL com `heartbeatHandler is not a function` (ou erro de import).

- [ ] **Step 3: Completar `src/agent/http.ts`**

Trocar o bloco de imports no topo por:

```ts
import { timingSafeEqual } from "node:crypto";
import { withOrg } from "@/db/tenant";
import { claimNextCommand, finishCommand, recordHeartbeat } from "@/domain/agent";
import { AppError } from "@/lib/errors";
import { requireTerminal } from "@/pdv/auth";
import { bodyOf, errorResponse, handle } from "@/pdv/http";
import { MAX_RELEASE_BYTES, releaseStore } from "./releases";
```

E acrescentar ao fim do arquivo:

```ts
/**
 * The agent calls this every 30 s. The heartbeat and the claim share one transaction: the terminal row lock
 * taken by the heartbeat update makes simultaneous heartbeats of one terminal take turns.
 */
export const heartbeatHandler = (req: Request, now: Date = new Date()) =>
  handle(req, async (t) => {
    const raw = await bodyOf(req);
    const claimed = await withOrg(t.orgId, async (tx) => {
      await recordHeartbeat(tx, t.terminalId, raw, now);
      return claimNextCommand(tx, t.terminalId, now);
    });
    if (!claimed) return { command: null };
    if (claimed.type !== "update") return { command: { id: claimed.id, type: claimed.type } };
    const meta = await releaseStore.meta(claimed.payload.version ?? "");
    if (!meta) {
      await withOrg(t.orgId, (tx) =>
        finishCommand(tx, t.terminalId, claimed.id, { ok: false, error: "release_not_found" }, now),
      );
      return { command: null };
    }
    return { command: { id: claimed.id, type: claimed.type, version: meta.version, sha256: meta.sha256 } };
  });

export const resultHandler = (req: Request, commandId: string, now: Date = new Date()) =>
  handle(req, async (t) => {
    const raw = await bodyOf(req);
    await withOrg(t.orgId, (tx) => finishCommand(tx, t.terminalId, commandId, raw, now));
    return { ok: true };
  });

export async function releaseHandler(req: Request, version: string): Promise<Response> {
  try {
    await requireTerminal(req);
    const found = await releaseStore.get(version);
    if (!found) throw new AppError("release_not_found");
    return new Response(new Uint8Array(found.data), {
      headers: { "content-type": "application/gzip", "x-sha256": found.meta.sha256 },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
```

- [ ] **Step 4: Criar as três rotas**

`src/app/api/agent/heartbeat/route.ts`:

```ts
import { heartbeatHandler } from "@/agent/http";

export const POST = (req: Request) => heartbeatHandler(req);
```

`src/app/api/agent/commands/[id]/result/route.ts`:

```ts
import { resultHandler } from "@/agent/http";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return resultHandler(req, (await params).id);
}
```

`src/app/api/agent/releases/[version]/route.ts`:

```ts
import { releaseHandler } from "@/agent/http";

export async function GET(req: Request, { params }: { params: Promise<{ version: string }> }) {
  return releaseHandler(req, (await params).version);
}
```

- [ ] **Step 5: Rodar os testes, typecheck e suíte**

Run: `npx vitest run tests/agent-api && npm run typecheck && npm test`
Expected: PASS e sem erros de tipo.

- [ ] **Step 6: Commit**

```bash
git add src/agent/http.ts src/app/api/agent tests/agent-api/handlers.test.ts
git commit -m "feat: add agent heartbeat, command result and release download routes"
```

---

### Task 5: Painel do dono (estado, comandos e histórico)

**Files:**
- Modify: `src/app/o/[orgId]/terminals/page.tsx`, `src/app/o/[orgId]/terminals/actions.ts`, `src/app/o/[orgId]/page.tsx`, `src/lib/labels.ts`

**Interfaces:**
- Consumes: `listTerminals` (com `lastHeartbeatAt`, `agentVersion`, `pdvStatus`, `timezone`), `isOnline`, `listCommands`, `createCommand`, `countOfflineTerminals` (`@/domain/agent`), `releaseStore.latest()`, `userEmails` (`@/auth/service`), `requireOrg`, `requireOrgPage`, `redirectOnAppError`.
- Produces: `sendCommandAction(orgId: string, terminalId: string, type: string): Promise<void>` (Server Action); `COMMAND_LABEL`, `COMMAND_STATUS_LABEL` em `src/lib/labels.ts`.

Esta tarefa é de interface: a lógica já está coberta pelos testes das Tarefas 2 e 4. A verificação é typecheck, `next build` e o roteiro da Tarefa 12.

- [ ] **Step 1: Rótulos**

Acrescentar ao fim de `src/lib/labels.ts`:

```ts
export const COMMAND_LABEL: Record<string, string> = {
  restart_pdv: "Reiniciar PDV",
  reboot: "Reboot",
  update: "Atualizar agente",
};

export const COMMAND_STATUS_LABEL: Record<string, string> = {
  pending: "Na fila",
  delivered: "Enviado ao totem",
  succeeded: "Concluído",
  failed: "Falhou",
};
```

- [ ] **Step 2: Server Action**

Em `src/app/o/[orgId]/terminals/actions.ts`, substituir as três linhas de import de `@/auth/guard`, `@/db/tenant` e `@/domain/terminals` por:

```ts
import { releaseStore } from "@/agent/releases";
import { requireOrg } from "@/auth/guard";
import { withOrg } from "@/db/tenant";
import { createCommand } from "@/domain/agent";
import { createTerminal, revokeTerminal } from "@/domain/terminals";
```

(os demais imports ficam como estão) e acrescentar ao fim do arquivo:

```ts
/** `update` always targets the most recently published package; the others carry no data. */
export async function sendCommandAction(orgId: string, terminalId: string, type: string) {
  const path = `/o/${orgId}/terminals`;
  try {
    const { userId } = await requireOrg(orgId, "terminal:write");
    let version: string | undefined;
    if (type === "update") {
      const latest = await releaseStore.latest();
      if (!latest) throw new AppError("release_not_found");
      version = latest.version;
    }
    await withOrg(orgId, (tx) => createCommand(tx, orgId, userId, { terminalId, type, version }, new Date()));
  } catch (e) {
    redirectOnAppError(e, path);
  }
  redirect(path);
}
```

- [ ] **Step 3: Página de totens**

Substituir o conteúdo de `src/app/o/[orgId]/terminals/page.tsx` por:

```tsx
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
import { revokeTerminalAction, sendCommandAction } from "./actions";

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
            <th>Nome</th><th>Mercado</th><th>Estado</th><th>Última batida</th><th>Agente</th><th>PDV</th><th>Ações</th>
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
                <td colSpan={7}>
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
```

- [ ] **Step 4: Contagem de totens offline no painel**

Em `src/app/o/[orgId]/page.tsx`, acrescentar o import `import { countOfflineTerminals } from "@/domain/agent";`, trocar a consulta e o início do JSX por:

```tsx
  const { markets, today, offline } = await withOrg(orgId, async (tx) => ({
    markets: await Promise.all((await listMarkets(tx)).map(async (m) => ({ ...m, low: await listLowStock(tx, m.id) }))),
    today: can(role, "sale:read") ? await salesToday(tx) : null,
    offline: can(role, "terminal:write") ? await countOfflineTerminals(tx, new Date()) : null,
  }));
  return (
    <main>
      <h1>Painel</h1>
      {offline !== null && offline > 0 && (
        <p role="alert">
          <a href={`/o/${orgId}/terminals`}>
            <strong>{offline} totem(ns) offline</strong>
          </a>
        </p>
      )}
```

(o restante do JSX, a partir de `{today && (`, fica como está).

- [ ] **Step 5: Typecheck e build**

Run: `npm run typecheck && npm run build`
Expected: sem erros; o build lista a rota `/o/[orgId]/terminals`.

- [ ] **Step 6: Commit**

```bash
git add src/app/o src/lib/labels.ts
git commit -m "feat: show terminal state and send remote commands from the owner panel"
```

---

### Task 6: PDV lê o token do fragmento da URL

**Files:**
- Create: `src/pdv/token.ts`, `tests/pdv/token.test.ts`
- Modify: `src/app/pdv/PdvApp.tsx`

**Interfaces:**
- Produces: `tokenFromHash(hash: string): string | null` em `src/pdv/token.ts`.
- Consumes (já existentes em `PdvApp.tsx`): `saveToken`, `readToken`, `setToken`.

- [ ] **Step 1: Escrever o teste (falha)**

Criar `tests/pdv/token.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { tokenFromHash } from "@/pdv/token";

const TOKEN = "YICrAdoFbgBTwO0isQT3ZfdQ_zgnKqNluOiuLwVXQXM";

describe("tokenFromHash", () => {
  it("reads a base64url token from the fragment, with or without the leading #", () => {
    expect(tokenFromHash(`#token=${TOKEN}`)).toBe(TOKEN);
    expect(tokenFromHash(`token=${TOKEN}`)).toBe(TOKEN);
    expect(tokenFromHash(`#x=1&token=${TOKEN}&y=2`)).toBe(TOKEN);
  });

  it("ignores a missing, empty, short or malformed token", () => {
    for (const h of ["", "#", "#token=", "#token=abc", `#token=${TOKEN}<script>`, "#other=1", `#token=${"a".repeat(101)}`]) {
      expect(tokenFromHash(h)).toBeNull();
    }
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/pdv/token.test.ts`
Expected: FAIL com `Cannot find module '@/pdv/token'`.

- [ ] **Step 3: Implementar**

Criar `src/pdv/token.ts`:

```ts
const TOKEN_RE = /^[A-Za-z0-9_-]{20,100}$/;

/** The agent opens /pdv#token=...; a fragment never reaches the server. Returns null for anything that is not a plausible token. */
export function tokenFromHash(hash: string): string | null {
  const token = new URLSearchParams(hash.replace(/^#/, "")).get("token");
  return token !== null && TOKEN_RE.test(token) ? token : null;
}
```

- [ ] **Step 4: Usar no PDV**

Em `src/app/pdv/PdvApp.tsx`, acrescentar ao grupo de imports `import { tokenFromHash } from "@/pdv/token";` e trocar a linha `useEffect(() => setToken(readToken()), []);` por:

```tsx
  useEffect(() => {
    // The totem agent opens /pdv#token=...: keep the token and clean the address bar.
    const fromAgent = tokenFromHash(window.location.hash);
    if (fromAgent) {
      saveToken(fromAgent);
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
      setToken(fromAgent);
      return;
    }
    setToken(readToken());
  }, []);
```

- [ ] **Step 5: Rodar testes e typecheck**

Run: `npx vitest run tests/pdv && npm run typecheck`
Expected: PASS e sem erros de tipo.

- [ ] **Step 6: Commit**

```bash
git add src/pdv/token.ts src/app/pdv/PdvApp.tsx tests/pdv/token.test.ts
git commit -m "feat: let the PDV take its token from the URL fragment"
```

---

### Task 7: Agente, configuração e cliente da API

**Files:**
- Create: `agent/package.json`, `agent/config.ts`, `agent/api.ts`, `tests/agent/config.test.ts`, `tests/agent/api.test.ts`
- Modify: `tsconfig.json` (`allowImportingTsExtensions`)

**Interfaces:**
- Produces:
  - `agent/config.ts`: `type Config = { serverUrl: string; token: string; browserCommand: string }`, `parseConfig(text: string): Config`
  - `agent/api.ts`: `class ApiError extends Error { status: number; code: string }`, `type Command = { id: string; type: string; version?: string; sha256?: string }`, `createApi(cfg: { serverUrl: string; token: string }, fetchFn?: typeof fetch)` com `heartbeat(body: { agentVersion: string; pdvStatus: "running" | "stopped" }): Promise<Command | null>`, `reportResult(id: string, ok: boolean, error?: string): Promise<void>`, `downloadRelease(version: string): Promise<{ data: Buffer; sha256: string | null }>`; `type Api = ReturnType<typeof createApi>`
- Contrato do servidor: o da Tarefa 4.

Regras do código em `agent/`: sem `enum`, `namespace` nem parameter properties; imports relativos terminam em `.ts`; nenhum import de `src/` nem de `node_modules`.

- [ ] **Step 1: `package.json` do agente e `tsconfig`**

Criar `agent/package.json`:

```json
{
  "private": true,
  "type": "module"
}
```

Em `tsconfig.json`, acrescentar `"allowImportingTsExtensions": true,` dentro de `compilerOptions` (depois de `"noEmit": true,`). O `tsc` já roda com `noEmit`, que essa opção exige.

- [ ] **Step 2: Escrever os testes (falham)**

Criar `tests/agent/config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseConfig } from "../../agent/config.ts";

const TOKEN = "YICrAdoFbgBTwO0isQT3ZfdQ_zgnKqNluOiuLwVXQXM";
const good = (o: object = {}) => JSON.stringify({ serverUrl: "https://m77.example.com/", token: TOKEN, ...o });

describe("parseConfig", () => {
  it("reads the server and token, trims the trailing slash and defaults the browser", () => {
    expect(parseConfig(good())).toEqual({
      serverUrl: "https://m77.example.com",
      token: TOKEN,
      browserCommand: "chromium-browser",
    });
    expect(parseConfig(good({ browserCommand: "google-chrome" })).browserCommand).toBe("google-chrome");
  });

  it("allows plain http only for localhost", () => {
    expect(parseConfig(good({ serverUrl: "http://localhost:3457" })).serverUrl).toBe("http://localhost:3457");
    expect(() => parseConfig(good({ serverUrl: "http://m77.example.com" }))).toThrow(/serverUrl/);
    expect(() => parseConfig(good({ serverUrl: "ftp://x" }))).toThrow(/serverUrl/);
  });

  it("rejects broken JSON and a missing or malformed token", () => {
    expect(() => parseConfig("{")).toThrow(/JSON/);
    expect(() => parseConfig(good({ token: "short" }))).toThrow(/token/);
    expect(() => parseConfig(JSON.stringify({ serverUrl: "https://x.com" }))).toThrow(/token/);
    expect(() => parseConfig("null")).toThrow(/serverUrl/);
  });
});
```

Criar `tests/agent/api.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ApiError, createApi } from "../../agent/api.ts";

type Call = { url: string; init: RequestInit };
function fakeFetch(respond: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    const call = { url, init };
    calls.push(call);
    return respond(call);
  }) as unknown as typeof fetch;
  return { fn, calls };
}
const cfg = { serverUrl: "https://m77.example.com", token: "TOKEN-TOKEN-TOKEN-TOKEN" };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe("agent api client", () => {
  it("sends the heartbeat with the bearer token and returns the command", async () => {
    const { fn, calls } = fakeFetch(() => json(200, { command: { id: "c1", type: "reboot" } }));
    const cmd = await createApi(cfg, fn).heartbeat({ agentVersion: "1.0.0", pdvStatus: "running" });
    expect(cmd).toEqual({ id: "c1", type: "reboot" });
    expect(calls[0].url).toBe("https://m77.example.com/api/agent/heartbeat");
    expect(calls[0].init.method).toBe("POST");
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe(`Bearer ${cfg.token}`);
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ agentVersion: "1.0.0", pdvStatus: "running" });
  });

  it("returns null when the server has no command", async () => {
    const { fn } = fakeFetch(() => json(200, { command: null }));
    expect(await createApi(cfg, fn).heartbeat({ agentVersion: "1.0.0", pdvStatus: "stopped" })).toBeNull();
  });

  it("throws ApiError with the status and the server error code", async () => {
    const { fn } = fakeFetch(() => json(401, { error: "terminal_revoked", message: "x" }));
    const err = await createApi(cfg, fn).heartbeat({ agentVersion: "1.0.0", pdvStatus: "running" }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect([err.status, err.code]).toEqual([401, "terminal_revoked"]);
  });

  it("uses a generic code when the error body is not JSON", async () => {
    const { fn } = fakeFetch(() => new Response("<html>bad gateway</html>", { status: 502 }));
    const err = await createApi(cfg, fn).heartbeat({ agentVersion: "1.0.0", pdvStatus: "running" }).catch((e) => e);
    expect([err.status, err.code]).toEqual([502, "http_502"]);
  });

  it("lets a network failure through as a rejection", async () => {
    const fn = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    await expect(createApi(cfg, fn).heartbeat({ agentVersion: "1.0.0", pdvStatus: "running" })).rejects.toThrow(/ECONNREFUSED/);
  });

  it("reports a command result", async () => {
    const { fn, calls } = fakeFetch(() => json(200, { ok: true }));
    await createApi(cfg, fn).reportResult("c1", false, "boom");
    expect(calls[0].url).toBe("https://m77.example.com/api/agent/commands/c1/result");
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ ok: false, error: "boom" });
  });

  it("downloads a release with its SHA-256 header", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const { fn, calls } = fakeFetch(() => new Response(bytes, { headers: { "x-sha256": "abc" } }));
    const got = await createApi(cfg, fn).downloadRelease("1.2.3");
    expect(calls[0].url).toBe("https://m77.example.com/api/agent/releases/1.2.3");
    expect([got.data.equals(Buffer.from(bytes)), got.sha256]).toEqual([true, "abc"]);
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest run tests/agent/config.test.ts tests/agent/api.test.ts`
Expected: FAIL com `Cannot find module '../../agent/config.ts'`.

- [ ] **Step 4: Implementar `agent/config.ts`**

```ts
export type Config = { serverUrl: string; token: string; browserCommand: string };

/** Parses /opt/market77/config.json. Plain http is accepted only for localhost (development). */
export function parseConfig(text: string): Config {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("config.json is not valid JSON");
  }
  const o = (raw ?? {}) as Record<string, unknown>;
  const serverUrl = typeof o.serverUrl === "string" ? o.serverUrl.replace(/\/+$/, "") : "";
  if (!/^https:\/\/[^\s]+$/.test(serverUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(serverUrl)) {
    throw new Error("serverUrl must be https (http only for localhost)");
  }
  const token = typeof o.token === "string" ? o.token : "";
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) throw new Error("token is missing or malformed");
  const browserCommand =
    typeof o.browserCommand === "string" && o.browserCommand !== "" ? o.browserCommand : "chromium-browser";
  return { serverUrl, token, browserCommand };
}
```

- [ ] **Step 5: Implementar `agent/api.ts`**

```ts
export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super(code);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export type Command = { id: string; type: string; version?: string; sha256?: string };

const CALL_TIMEOUT_MS = 10_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;

export function createApi(cfg: { serverUrl: string; token: string }, fetchFn: typeof fetch = fetch) {
  async function request(method: string, path: string, body: unknown, timeoutMs: number): Promise<Response> {
    const res = await fetchFn(`${cfg.serverUrl}${path}`, {
      method,
      headers: { authorization: `Bearer ${cfg.token}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: unknown };
      throw new ApiError(res.status, typeof data.error === "string" ? data.error : `http_${res.status}`);
    }
    return res;
  }

  return {
    async heartbeat(body: { agentVersion: string; pdvStatus: "running" | "stopped" }): Promise<Command | null> {
      const res = await request("POST", "/api/agent/heartbeat", body, CALL_TIMEOUT_MS);
      const data = (await res.json()) as { command: Command | null };
      return data.command ?? null;
    },
    async reportResult(id: string, ok: boolean, error?: string): Promise<void> {
      await request("POST", `/api/agent/commands/${id}/result`, { ok, error }, CALL_TIMEOUT_MS);
    },
    async downloadRelease(version: string): Promise<{ data: Buffer; sha256: string | null }> {
      const res = await request("GET", `/api/agent/releases/${version}`, undefined, DOWNLOAD_TIMEOUT_MS);
      return { data: Buffer.from(await res.arrayBuffer()), sha256: res.headers.get("x-sha256") };
    },
  };
}

export type Api = ReturnType<typeof createApi>;
```

- [ ] **Step 6: Rodar os testes e o typecheck**

Run: `npx vitest run tests/agent && npm run typecheck`
Expected: PASS e sem erros de tipo.

- [ ] **Step 7: Commit**

```bash
git add agent/package.json agent/config.ts agent/api.ts tests/agent tsconfig.json
git commit -m "feat: add totem agent config parser and API client"
```

---

### Task 8: Agente, supervisor do Chromium

**Files:**
- Create: `agent/browser.ts`, `tests/agent/browser.test.ts`

**Interfaces:**
- Produces: `type ChildLike = { kill(): void; on(event: "exit", cb: () => void): void }`, `type BrowserDeps = { spawn(command: string, args: string[]): ChildLike; schedule(fn: () => void, ms: number): unknown; cancel(handle: unknown): void; now(): number; log(message: string): void }`, `type Browser = { start(): void; stop(): Promise<void>; restart(): Promise<void>; running(): boolean }`, `createBrowser(opts: { command: string; url: string; profileDir: string }, deps: BrowserDeps): Browser`.
- Comportamento: relança o Chromium quando ele morre sozinho, com espera 1 s, 2 s, 4 s, até 30 s; a contagem volta ao zero quando ele ficou de pé por 60 s ou mais; `restart()` espera o processo antigo sair (no máximo 5 s) antes de abrir o novo.

- [ ] **Step 1: Escrever o teste (falha)**

Criar `tests/agent/browser.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { type BrowserDeps, createBrowser } from "../../agent/browser.ts";

function fakeEnv() {
  type Child = { args: string[]; killed: boolean; kill(): void; on(e: "exit", cb: () => void): void; exit(): void };
  const children: Child[] = [];
  const timers: { fn: () => void; ms: number; cancelled: boolean }[] = [];
  let clock = 0;
  const deps: BrowserDeps = {
    spawn: (_cmd, args) => {
      const listeners: (() => void)[] = [];
      const c: Child = {
        args,
        killed: false,
        kill: () => {
          c.killed = true;
        },
        on: (_e, cb) => {
          listeners.push(cb);
        },
        exit: () => listeners.forEach((l) => l()),
      };
      children.push(c);
      return c;
    },
    schedule: (fn, ms) => {
      const t = { fn, ms, cancelled: false };
      timers.push(t);
      return t;
    },
    cancel: (h) => {
      (h as { cancelled: boolean }).cancelled = true;
    },
    now: () => clock,
    log: () => {},
  };
  const fire = () => {
    for (const t of timers.splice(0)) if (!t.cancelled) t.fn();
  };
  return { deps, children, timers, fire, advance: (ms: number) => (clock += ms) };
}
const opts = { command: "chromium-browser", url: "https://m77.example.com/pdv#token=T", profileDir: "/p" };

describe("browser supervisor", () => {
  it("starts once in kiosk mode on the PDV url", () => {
    const e = fakeEnv();
    const b = createBrowser(opts, e.deps);
    b.start();
    b.start();
    expect(e.children).toHaveLength(1);
    expect(e.children[0].args).toContain("--kiosk");
    expect(e.children[0].args).toContain("--user-data-dir=/p");
    expect(e.children[0].args.at(-1)).toBe(opts.url);
    expect(b.running()).toBe(true);
  });

  it("relaunches after an unexpected exit with a growing wait capped at 30 s", () => {
    const e = fakeEnv();
    const b = createBrowser(opts, e.deps);
    b.start();
    const waits: number[] = [];
    for (let i = 0; i < 8; i++) {
      e.children.at(-1)!.exit();
      expect(b.running()).toBe(false);
      waits.push(e.timers.at(-1)!.ms);
      e.fire();
      expect(b.running()).toBe(true);
    }
    expect(waits).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
  });

  it("starts the backoff over when the browser stayed up for a minute", () => {
    const e = fakeEnv();
    const b = createBrowser(opts, e.deps);
    b.start();
    e.children.at(-1)!.exit();
    e.fire();
    e.children.at(-1)!.exit();
    e.fire();
    e.advance(60_000);
    e.children.at(-1)!.exit();
    expect(e.timers.at(-1)!.ms).toBe(1000);
  });

  it("schedules one relaunch even when exit is reported twice", () => {
    const e = fakeEnv();
    const b = createBrowser(opts, e.deps);
    b.start();
    e.children[0].exit();
    e.children[0].exit();
    e.fire();
    expect(e.children).toHaveLength(2);
    expect(b.running()).toBe(true);
  });

  it("restart waits for the old process to leave, then opens a new one without a relaunch race", async () => {
    const e = fakeEnv();
    const b = createBrowser(opts, e.deps);
    b.start();
    const p = b.restart();
    expect(e.children[0].killed).toBe(true);
    e.children[0].exit();
    await p;
    expect(e.children).toHaveLength(2);
    e.fire();
    expect(e.children).toHaveLength(2);
    expect(b.running()).toBe(true);
  });

  it("restart gives up waiting after 5 s", async () => {
    const e = fakeEnv();
    const b = createBrowser(opts, e.deps);
    b.start();
    const p = b.restart();
    expect(e.timers.at(-1)!.ms).toBe(5000);
    e.fire();
    await p;
    expect(e.children).toHaveLength(2);
  });

  it("stop kills the browser and does not relaunch it", async () => {
    const e = fakeEnv();
    const b = createBrowser(opts, e.deps);
    b.start();
    const p = b.stop();
    e.children[0].exit();
    await p;
    e.fire();
    expect(e.children).toHaveLength(1);
    expect(b.running()).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/agent/browser.test.ts`
Expected: FAIL com `Cannot find module '../../agent/browser.ts'`.

- [ ] **Step 3: Implementar `agent/browser.ts`**

```ts
export type ChildLike = { kill(): void; on(event: "exit", cb: () => void): void };

export type BrowserDeps = {
  spawn(command: string, args: string[]): ChildLike;
  schedule(fn: () => void, ms: number): unknown;
  cancel(handle: unknown): void;
  now(): number;
  log(message: string): void;
};

export type Browser = {
  start(): void;
  stop(): Promise<void>;
  restart(): Promise<void>;
  running(): boolean;
};

const STABLE_AFTER_MS = 60_000;
const MAX_BACKOFF_MS = 30_000;
const KILL_WAIT_MS = 5_000;

/** Keeps the kiosk browser alive: relaunches it when it dies by itself, and replaces it on demand. */
export function createBrowser(opts: { command: string; url: string; profileDir: string }, deps: BrowserDeps): Browser {
  let child: ChildLike | null = null;
  let wanted = false;
  let failures = 0;
  let startedAt = 0;
  let retry: unknown = null;

  function launch(): void {
    const c = deps.spawn(opts.command, [
      "--kiosk",
      "--noerrdialogs",
      "--disable-infobars",
      "--no-first-run",
      `--user-data-dir=${opts.profileDir}`,
      opts.url,
    ]);
    child = c;
    startedAt = deps.now();
    c.on("exit", () => {
      if (child !== c) return; // replaced or already handled
      child = null;
      if (!wanted) return;
      if (deps.now() - startedAt >= STABLE_AFTER_MS) failures = 0;
      failures += 1;
      const wait = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** (failures - 1));
      deps.log(`browser exited, relaunching in ${wait} ms`);
      retry = deps.schedule(() => {
        retry = null;
        if (wanted && child === null) launch();
      }, wait);
    });
  }

  async function stopChild(): Promise<void> {
    const old = child;
    child = null;
    if (retry !== null) {
      deps.cancel(retry);
      retry = null;
    }
    if (old === null) return;
    await new Promise<void>((resolve) => {
      let timer: unknown = null;
      const done = () => {
        if (timer !== null) deps.cancel(timer);
        resolve();
      };
      old.on("exit", done);
      timer = deps.schedule(done, KILL_WAIT_MS);
      old.kill();
    });
  }

  return {
    start() {
      wanted = true;
      failures = 0;
      if (child === null) launch();
    },
    async stop() {
      wanted = false;
      await stopChild();
    },
    async restart() {
      wanted = true;
      failures = 0;
      await stopChild();
      launch();
    },
    running: () => child !== null,
  };
}
```

- [ ] **Step 4: Rodar os testes e o typecheck**

Run: `npx vitest run tests/agent/browser.test.ts && npm run typecheck`
Expected: PASS e sem erros de tipo.

- [ ] **Step 5: Commit**

```bash
git add agent/browser.ts tests/agent/browser.test.ts
git commit -m "feat: add kiosk browser supervisor for the totem agent"
```

---

### Task 9: Agente, ciclo do heartbeat e comandos

**Files:**
- Create: `agent/loop.ts`, `tests/agent/loop.test.ts`

**Interfaces:**
- Consumes: `ApiError`, `Command`, `Api` (`./api.ts`).
- Produces: `HEARTBEAT_MS = 30000`, `REVOKED_RETRY_MS = 300000`, `FAILURES_BEFORE_RESTART = 5`, `type AgentDeps`, `createAgent(d: AgentDeps): { tick(): Promise<number> }`. `tick()` nunca lança e devolve a espera em ms até o próximo.

```ts
type AgentDeps = {
  api: Pick<Api, "heartbeat" | "reportResult">;
  browser: { running(): boolean; restart(): Promise<void> };
  system: { reboot(): Promise<void>; exit(): void };
  update: { apply(version: string, sha256: string): Promise<void>; confirmBoot(): Promise<void> };
  version: string;
  sleep(ms: number): Promise<void>;
  log(message: string): void;
};
```

- [ ] **Step 1: Escrever o teste (falha)**

Criar `tests/agent/loop.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ApiError, type Command } from "../../agent/api.ts";
import { FAILURES_BEFORE_RESTART, HEARTBEAT_MS, REVOKED_RETRY_MS, createAgent } from "../../agent/loop.ts";

function setup(over: { heartbeat?: () => Promise<Command | null>; reportResult?: () => Promise<void>; apply?: () => Promise<void>; running?: boolean } = {}) {
  const events: string[] = [];
  const beats: unknown[] = [];
  const agent = createAgent({
    api: {
      heartbeat: async (body) => {
        beats.push(body);
        return over.heartbeat ? over.heartbeat() : null;
      },
      reportResult: async (id, ok, error) => {
        events.push(`report:${id}:${ok}${error ? `:${error}` : ""}`);
        if (over.reportResult) await over.reportResult();
      },
    },
    browser: {
      running: () => over.running ?? true,
      restart: async () => {
        events.push("browser.restart");
      },
    },
    system: {
      reboot: async () => {
        events.push("system.reboot");
      },
      exit: () => {
        events.push("system.exit");
      },
    },
    update: {
      apply: async (v, sha) => {
        events.push(`update.apply:${v}:${sha}`);
        if (over.apply) await over.apply();
      },
      confirmBoot: async () => {
        events.push("confirmBoot");
      },
    },
    version: "1.0.0",
    sleep: async (ms) => {
      events.push(`sleep:${ms}`);
    },
    log: () => {},
  });
  return { agent, events, beats };
}
const cmd = (c: Partial<Command> & { type: string }): Command => ({ id: "c1", ...c });

describe("heartbeat loop", () => {
  it("sends its version and the PDV state and waits 30 s", async () => {
    const a = setup({ running: false });
    expect(await a.agent.tick()).toBe(HEARTBEAT_MS);
    expect(a.beats).toEqual([{ agentVersion: "1.0.0", pdvStatus: "stopped" }]);
  });

  it("restarts the browser after five failures in a row, then starts counting again", async () => {
    const a = setup({
      heartbeat: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    for (let i = 1; i < FAILURES_BEFORE_RESTART; i++) await a.agent.tick();
    expect(a.events).not.toContain("browser.restart");
    await a.agent.tick();
    expect(a.events.filter((e) => e === "browser.restart")).toHaveLength(1);
    for (let i = 1; i < FAILURES_BEFORE_RESTART; i++) await a.agent.tick();
    expect(a.events.filter((e) => e === "browser.restart")).toHaveLength(1);
    await a.agent.tick();
    expect(a.events.filter((e) => e === "browser.restart")).toHaveLength(2);
  });

  it("does not count failures that a success interrupts", async () => {
    let n = 0;
    const a = setup({
      heartbeat: async () => {
        n += 1;
        if (n % 3 === 0) return null;
        throw new Error("down");
      },
    });
    for (let i = 0; i < 12; i++) await a.agent.tick();
    expect(a.events).not.toContain("browser.restart");
  });

  it("backs off for five minutes when the terminal was revoked and never reboots the machine on its own", async () => {
    const a = setup({
      heartbeat: async () => {
        throw new ApiError(401, "terminal_revoked");
      },
    });
    for (let i = 0; i < 10; i++) expect(await a.agent.tick()).toBe(REVOKED_RETRY_MS);
    expect(a.events).toEqual([]);
  });

  it("confirms a finished update on the first good heartbeat only", async () => {
    const a = setup();
    await a.agent.tick();
    await a.agent.tick();
    expect(a.events.filter((e) => e === "confirmBoot")).toHaveLength(1);
  });

  it("keeps the normal wait after running a command", async () => {
    const a = setup({ heartbeat: async () => cmd({ type: "restart_pdv" }) });
    await expect(a.agent.tick()).resolves.toBe(HEARTBEAT_MS);
  });
});

describe("commands", () => {
  it("restart_pdv restarts the browser and then reports success", async () => {
    const a = setup({ heartbeat: async () => cmd({ type: "restart_pdv" }) });
    await a.agent.tick();
    expect(a.events.filter((e) => e !== "confirmBoot")).toEqual(["browser.restart", "report:c1:true"]);
  });

  it("reboot reports success first and only then reboots", async () => {
    const a = setup({ heartbeat: async () => cmd({ type: "reboot" }) });
    await a.agent.tick();
    expect(a.events.filter((e) => e !== "confirmBoot")).toEqual(["report:c1:true", "system.reboot"]);
  });

  it("reboot retries the confirmation and never reboots when it cannot be confirmed", async () => {
    const a = setup({
      heartbeat: async () => cmd({ type: "reboot" }),
      reportResult: async () => {
        throw new Error("network");
      },
    });
    await a.agent.tick();
    expect(a.events).not.toContain("system.reboot");
    expect(a.events.filter((e) => e.startsWith("report:"))).toHaveLength(3);
    expect(a.events.filter((e) => e.startsWith("sleep:"))).toEqual(["sleep:2000", "sleep:2000"]);
  });

  it("reboot works when the second confirmation attempt succeeds", async () => {
    let tries = 0;
    const a = setup({
      heartbeat: async () => cmd({ type: "reboot" }),
      reportResult: async () => {
        tries += 1;
        if (tries === 1) throw new Error("blip");
      },
    });
    await a.agent.tick();
    expect(a.events).toContain("system.reboot");
  });

  it("update applies the package, reports success and then exits so systemd starts the new version", async () => {
    const a = setup({ heartbeat: async () => cmd({ type: "update", version: "1.1.0", sha256: "ab" }) });
    await a.agent.tick();
    expect(a.events.filter((e) => e !== "confirmBoot")).toEqual(["update.apply:1.1.0:ab", "report:c1:true", "system.exit"]);
  });

  it("update still exits when the success report cannot be delivered, because the package is already switched", async () => {
    const a = setup({
      heartbeat: async () => cmd({ type: "update", version: "1.1.0", sha256: "ab" }),
      reportResult: async () => {
        throw new Error("network");
      },
    });
    await a.agent.tick();
    expect(a.events).toContain("system.exit");
  });

  it("update to the version already running just reports success", async () => {
    const a = setup({ heartbeat: async () => cmd({ type: "update", version: "1.0.0", sha256: "ab" }) });
    await a.agent.tick();
    expect(a.events.filter((e) => e !== "confirmBoot")).toEqual(["report:c1:true"]);
  });

  it("update that fails reports the error and does not exit", async () => {
    const a = setup({
      heartbeat: async () => cmd({ type: "update", version: "1.1.0", sha256: "ab" }),
      apply: async () => {
        throw new Error("sha256_mismatch");
      },
    });
    await a.agent.tick();
    expect(a.events.filter((e) => e !== "confirmBoot")).toEqual(["update.apply:1.1.0:ab", "report:c1:false:sha256_mismatch"]);
  });

  it("update without a version or hash fails without touching the disk", async () => {
    const a = setup({ heartbeat: async () => cmd({ type: "update" }) });
    await a.agent.tick();
    expect(a.events.filter((e) => e !== "confirmBoot")).toEqual(["report:c1:false:invalid_update"]);
  });

  it("an unknown command type is reported as failed and nothing runs", async () => {
    const a = setup({ heartbeat: async () => cmd({ type: "rm_rf" }) });
    await a.agent.tick();
    expect(a.events.filter((e) => e !== "confirmBoot")).toEqual(["report:c1:false:unknown_command"]);
  });

  it("restart_pdv that throws reports the failure", async () => {
    const events: string[] = [];
    const agent = createAgent({
      api: {
        heartbeat: async () => cmd({ type: "restart_pdv" }),
        reportResult: async (id, ok, error) => {
          events.push(`report:${id}:${ok}:${error}`);
        },
      },
      browser: {
        running: () => true,
        restart: async () => {
          throw new Error("chromium_missing");
        },
      },
      system: { reboot: async () => {}, exit: () => {} },
      update: { apply: async () => {}, confirmBoot: async () => {} },
      version: "1.0.0",
      sleep: async () => {},
      log: () => {},
    });
    await agent.tick();
    expect(events).toEqual(["report:c1:false:chromium_missing"]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/agent/loop.test.ts`
Expected: FAIL com `Cannot find module '../../agent/loop.ts'`.

- [ ] **Step 3: Implementar `agent/loop.ts`**

```ts
import { type Api, ApiError, type Command } from "./api.ts";

export const HEARTBEAT_MS = 30_000;
export const REVOKED_RETRY_MS = 300_000;
export const FAILURES_BEFORE_RESTART = 5;
const REPORT_TRIES = 3;
const REPORT_RETRY_MS = 2_000;
const VERSION_RE = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;

export type AgentDeps = {
  api: Pick<Api, "heartbeat" | "reportResult">;
  browser: { running(): boolean; restart(): Promise<void> };
  system: { reboot(): Promise<void>; exit(): void };
  update: { apply(version: string, sha256: string): Promise<void>; confirmBoot(): Promise<void> };
  version: string;
  sleep(ms: number): Promise<void>;
  log(message: string): void;
};

const reason = (e: unknown): string => (e instanceof Error ? e.message.slice(0, 200) : "error");

export function createAgent(d: AgentDeps): { tick(): Promise<number> } {
  let failures = 0;
  let booted = false;

  /** Tries up to three times; the server decides nothing from a missing report except to redeliver the command later. */
  async function report(id: string, ok: boolean, error?: string): Promise<boolean> {
    for (let i = 0; i < REPORT_TRIES; i++) {
      try {
        await d.api.reportResult(id, ok, error);
        return true;
      } catch {
        if (i < REPORT_TRIES - 1) await d.sleep(REPORT_RETRY_MS);
      }
    }
    return false;
  }

  async function execute(cmd: Command): Promise<void> {
    if (cmd.type === "restart_pdv") {
      try {
        await d.browser.restart();
      } catch (e) {
        await report(cmd.id, false, reason(e));
        return;
      }
      await report(cmd.id, true);
      return;
    }
    if (cmd.type === "reboot") {
      // Reboot only after the server knows the command is done; otherwise it would be redelivered after boot, in a loop.
      if (!(await report(cmd.id, true))) {
        d.log("reboot skipped: the server could not be told");
        return;
      }
      try {
        await d.system.reboot();
      } catch (e) {
        d.log(`reboot failed: ${reason(e)}`);
      }
      return;
    }
    if (cmd.type === "update") {
      if (!cmd.version || !cmd.sha256 || !VERSION_RE.test(cmd.version)) {
        await report(cmd.id, false, "invalid_update");
        return;
      }
      if (cmd.version === d.version) {
        await report(cmd.id, true);
        return;
      }
      try {
        await d.update.apply(cmd.version, cmd.sha256);
      } catch (e) {
        await report(cmd.id, false, reason(e));
        return;
      }
      await report(cmd.id, true);
      d.system.exit(); // the symlink already points at the new version; systemd starts it
      return;
    }
    await report(cmd.id, false, "unknown_command");
  }

  async function tick(): Promise<number> {
    let command: Command | null;
    try {
      command = await d.api.heartbeat({
        agentVersion: d.version,
        pdvStatus: d.browser.running() ? "running" : "stopped",
      });
    } catch (e) {
      if (e instanceof ApiError && e.code === "terminal_revoked") {
        d.log("terminal revoked: retrying in 5 minutes");
        return REVOKED_RETRY_MS;
      }
      failures += 1;
      d.log(`heartbeat failed (${failures} in a row): ${reason(e)}`);
      if (failures >= FAILURES_BEFORE_RESTART) {
        failures = 0;
        try {
          await d.browser.restart();
        } catch (err) {
          d.log(`browser restart failed: ${reason(err)}`);
        }
      }
      return HEARTBEAT_MS;
    }
    failures = 0;
    if (!booted) {
      booted = true;
      try {
        await d.update.confirmBoot();
      } catch (e) {
        d.log(`confirmBoot failed: ${reason(e)}`);
      }
    }
    if (command) {
      try {
        await execute(command);
      } catch (e) {
        d.log(`command ${command.id} failed: ${reason(e)}`);
      }
    }
    return HEARTBEAT_MS;
  }

  return { tick };
}
```

- [ ] **Step 4: Rodar os testes e o typecheck**

Run: `npx vitest run tests/agent/loop.test.ts && npm run typecheck`
Expected: PASS e sem erros de tipo.

- [ ] **Step 5: Commit**

```bash
git add agent/loop.ts tests/agent/loop.test.ts
git commit -m "feat: add totem agent heartbeat loop and command handling"
```

---

### Task 10: Agente, atualização com rollback

**Files:**
- Create: `agent/update.ts`, `agent/watchdog.sh`, `tests/agent/update.test.ts`, `tests/agent/watchdog.test.ts`

**Interfaces:**
- Produces em `agent/update.ts`:
  - `VERSION_RE`, `ROLLBACK_WINDOW_S = 120`
  - `type UpdateDeps = { baseDir: string; currentVersion: string; download(version: string): Promise<{ data: Buffer }>; extract(tarball: string, dest: string): Promise<void>; nowSeconds(): number }`
  - `applyUpdate(d: UpdateDeps, version: string, expectedSha256: string): Promise<void>` (lança `Error` com `invalid_version`, `sha256_mismatch` ou `invalid_package`)
  - `extractTar(tarball: string, dest: string): Promise<void>` (usa o `tar` do sistema)
  - `confirmBoot(baseDir: string): Promise<void>`
- Formato do marcador `<baseDir>/pending-update`: uma linha `<versão-anterior> <epoch-limite>`. `agent/watchdog.sh` lê esse arquivo.
- Layout: `<baseDir>/releases/<versão>/` e `<baseDir>/current` (symlink relativo `releases/<versão>`).

- [ ] **Step 1: Escrever os testes (falham)**

Criar `tests/agent/update.test.ts`:

```ts
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, readdir, readlink, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyUpdate, confirmBoot, extractTar } from "../../agent/update.ts";

async function makeBase() {
  const base = await mkdtemp(join(tmpdir(), "m77-base-"));
  await mkdir(join(base, "releases", "1.0.0"), { recursive: true });
  await writeFile(join(base, "releases", "1.0.0", "main.ts"), "old");
  await symlink(join("releases", "1.0.0"), join(base, "current"));
  return base;
}

async function makeTarball(files: Record<string, string>) {
  const src = await mkdtemp(join(tmpdir(), "m77-src-"));
  for (const [name, content] of Object.entries(files)) await writeFile(join(src, name), content);
  const out = join(await mkdtemp(join(tmpdir(), "m77-out-")), "r.tgz");
  execFileSync("tar", ["-czf", out, "-C", src, "."], { env: { ...process.env, COPYFILE_DISABLE: "1" } });
  const data = await readFile(out);
  return { data, sha: createHash("sha256").update(data).digest("hex") };
}

const deps = (base: string, data: Buffer) => ({
  baseDir: base,
  currentVersion: "1.0.0",
  download: async () => ({ data }),
  extract: extractTar,
  nowSeconds: () => 1000,
});
const exists = (p: string) => access(p).then(() => true, () => false);

describe("applyUpdate", () => {
  it("installs the package, writes the rollback marker and switches the symlink last", async () => {
    const base = await makeBase();
    const { data, sha } = await makeTarball({ "main.ts": "new", VERSION: "1.1.0\n" });
    await applyUpdate(deps(base, data), "1.1.0", sha);
    expect(await readlink(join(base, "current"))).toBe(join("releases", "1.1.0"));
    expect(await readFile(join(base, "releases", "1.1.0", "main.ts"), "utf8")).toBe("new");
    expect(await readFile(join(base, "pending-update"), "utf8")).toBe("1.0.0 1120\n");
    expect(await exists(join(base, "releases", "1.1.0", "release.tgz"))).toBe(false);
    expect((await readdir(join(base, "releases"))).sort()).toEqual(["1.0.0", "1.1.0"]);
  });

  it("changes nothing when the hash does not match", async () => {
    const base = await makeBase();
    const { data } = await makeTarball({ "main.ts": "new" });
    await expect(applyUpdate(deps(base, data), "1.1.0", "0".repeat(64))).rejects.toThrow(/sha256_mismatch/);
    expect(await readlink(join(base, "current"))).toBe(join("releases", "1.0.0"));
    expect(await readdir(join(base, "releases"))).toEqual(["1.0.0"]);
    expect(await exists(join(base, "pending-update"))).toBe(false);
  });

  it("changes nothing when the package has no main.ts", async () => {
    const base = await makeBase();
    const { data, sha } = await makeTarball({ "other.txt": "x" });
    await expect(applyUpdate(deps(base, data), "1.1.0", sha)).rejects.toThrow(/invalid_package/);
    expect(await readlink(join(base, "current"))).toBe(join("releases", "1.0.0"));
    expect(await readdir(join(base, "releases"))).toEqual(["1.0.0"]);
  });

  it("changes nothing when the file is not a valid archive even with a matching hash", async () => {
    const base = await makeBase();
    const data = Buffer.from("this is not a tarball");
    const sha = createHash("sha256").update(data).digest("hex");
    await expect(applyUpdate(deps(base, data), "1.1.0", sha)).rejects.toThrow();
    expect(await readlink(join(base, "current"))).toBe(join("releases", "1.0.0"));
    expect(await readdir(join(base, "releases"))).toEqual(["1.0.0"]);
  });

  it("refuses a malformed version before downloading anything", async () => {
    const base = await makeBase();
    let downloads = 0;
    const d = { ...deps(base, Buffer.alloc(0)), download: async () => (downloads++, { data: Buffer.alloc(0) }) };
    for (const v of ["../x", "1.0", "1.0.0/../../etc", "latest", ""]) {
      await expect(applyUpdate(d, v, "ab")).rejects.toThrow(/invalid_version/);
    }
    expect(downloads).toBe(0);
  });
});

describe("confirmBoot", () => {
  it("removes the marker and keeps only the current and the previous version", async () => {
    const base = await makeBase();
    await mkdir(join(base, "releases", "0.9.0"), { recursive: true });
    const { data, sha } = await makeTarball({ "main.ts": "new" });
    await applyUpdate(deps(base, data), "1.1.0", sha);
    await confirmBoot(base);
    expect(await exists(join(base, "pending-update"))).toBe(false);
    expect((await readdir(join(base, "releases"))).sort()).toEqual(["1.0.0", "1.1.0"]);
  });

  it("does nothing, and prunes nothing, when no update is pending", async () => {
    const base = await makeBase();
    await mkdir(join(base, "releases", "0.9.0"), { recursive: true });
    await confirmBoot(base);
    expect((await readdir(join(base, "releases"))).sort()).toEqual(["0.9.0", "1.0.0"]);
  });
});
```

Criar `tests/agent/watchdog.test.ts`:

```ts
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, readlink, symlink, writeFile } from "node:fs/promises";
import { access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const WATCHDOG = resolve("agent/watchdog.sh");
const exists = (p: string) => access(p).then(() => true, () => false);

async function setup(marker?: string) {
  const base = await mkdtemp(join(tmpdir(), "m77-wd-"));
  for (const v of ["1.0.0", "1.1.0"]) await mkdir(join(base, "releases", v), { recursive: true });
  await symlink(join("releases", "1.1.0"), join(base, "current"));
  const fake = join(base, "fake-systemctl.sh");
  await writeFile(fake, `#!/bin/sh\necho "$@" >> "${base}/calls"\n`);
  await chmod(fake, 0o755);
  if (marker !== undefined) await writeFile(join(base, "pending-update"), marker);
  const run = () => spawnSync("bash", [WATCHDOG], { env: { ...process.env, M77_BASE: base, M77_SYSTEMCTL: fake } });
  const calls = async () => ((await exists(join(base, "calls"))) ? readFile(join(base, "calls"), "utf8") : "");
  return { base, run, calls };
}

describe("watchdog", () => {
  it("does nothing without a marker", async () => {
    const s = await setup();
    expect(s.run().status).toBe(0);
    expect(await readlink(join(s.base, "current"))).toBe(join("releases", "1.1.0"));
    expect(await s.calls()).toBe("");
  });

  it("does nothing before the deadline and keeps the marker", async () => {
    const s = await setup("1.0.0 99999999999\n");
    expect(s.run().status).toBe(0);
    expect(await readlink(join(s.base, "current"))).toBe(join("releases", "1.1.0"));
    expect(await exists(join(s.base, "pending-update"))).toBe(true);
    expect(await s.calls()).toBe("");
  });

  it("rolls back to the previous version after the deadline and restarts the agent", async () => {
    const s = await setup("1.0.0 1\n");
    expect(s.run().status).toBe(0);
    expect(await readlink(join(s.base, "current"))).toBe(join("releases", "1.0.0"));
    expect(await exists(join(s.base, "pending-update"))).toBe(false);
    expect(await s.calls()).toBe("restart market77-agent\n");
  });

  it("drops a marker with a malformed version without touching anything", async () => {
    const s = await setup("../../etc 1\n");
    expect(s.run().status).toBe(0);
    expect(await readlink(join(s.base, "current"))).toBe(join("releases", "1.1.0"));
    expect(await exists(join(s.base, "pending-update"))).toBe(false);
    expect(await s.calls()).toBe("");
  });

  it("drops a marker whose previous version is gone", async () => {
    const s = await setup("0.0.1 1\n");
    expect(s.run().status).toBe(0);
    expect(await readlink(join(s.base, "current"))).toBe(join("releases", "1.1.0"));
    expect(await exists(join(s.base, "pending-update"))).toBe(false);
    expect(await s.calls()).toBe("");
  });

  it("drops a marker with a malformed deadline", async () => {
    const s = await setup("1.0.0 soon\n");
    expect(s.run().status).toBe(0);
    expect(await exists(join(s.base, "pending-update"))).toBe(false);
    expect(await readlink(join(s.base, "current"))).toBe(join("releases", "1.1.0"));
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/agent/update.test.ts tests/agent/watchdog.test.ts`
Expected: FAIL (`Cannot find module '../../agent/update.ts'` e script do watchdog inexistente).

- [ ] **Step 3: Implementar `agent/update.ts`**

```ts
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, readdir, readlink, rename, rm, symlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export const VERSION_RE = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
export const ROLLBACK_WINDOW_S = 120;

export type UpdateDeps = {
  baseDir: string;
  currentVersion: string;
  download(version: string): Promise<{ data: Buffer }>;
  extract(tarball: string, dest: string): Promise<void>;
  nowSeconds(): number;
};

export const extractTar = async (tarball: string, dest: string): Promise<void> => {
  await run("tar", ["-xzf", tarball, "-C", dest]);
};

/**
 * Installs a release next to the running one and switches the `current` symlink as the very last step.
 * Any failure before that leaves the disk as it was. The marker tells watchdog.sh to roll back if the new
 * agent does not complete a heartbeat within ROLLBACK_WINDOW_S.
 */
export async function applyUpdate(d: UpdateDeps, version: string, expectedSha256: string): Promise<void> {
  if (!VERSION_RE.test(version)) throw new Error("invalid_version");
  const { data } = await d.download(version);
  if (createHash("sha256").update(data).digest("hex") !== expectedSha256) throw new Error("sha256_mismatch");
  const dest = join(d.baseDir, "releases", version);
  const staging = `${dest}.tmp`;
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  try {
    const tarball = join(staging, "release.tgz");
    await writeFile(tarball, data);
    await d.extract(tarball, staging);
    await rm(tarball);
    await access(join(staging, "main.ts")).catch(() => {
      throw new Error("invalid_package");
    });
  } catch (e) {
    await rm(staging, { recursive: true, force: true });
    throw e;
  }
  await rm(dest, { recursive: true, force: true });
  await rename(staging, dest);
  await writeFile(join(d.baseDir, "pending-update"), `${d.currentVersion} ${d.nowSeconds() + ROLLBACK_WINDOW_S}\n`);
  const link = join(d.baseDir, "current.new");
  await rm(link, { force: true });
  await symlink(join("releases", version), link);
  await rename(link, join(d.baseDir, "current")); // atomic: replaces the old symlink
}

/** Called after the first good heartbeat: the update worked, so drop the marker and old releases. */
export async function confirmBoot(baseDir: string): Promise<void> {
  const marker = join(baseDir, "pending-update");
  let text: string;
  try {
    text = await readFile(marker, "utf8");
  } catch {
    return; // no update pending
  }
  const previous = text.trim().split(/\s+/)[0] ?? "";
  await rm(marker, { force: true });
  const current = basename(await readlink(join(baseDir, "current")));
  const keep = new Set([current, previous]);
  const releases = join(baseDir, "releases");
  for (const name of await readdir(releases)) {
    if (!keep.has(name)) await rm(join(releases, name), { recursive: true, force: true });
  }
}
```

- [ ] **Step 4: Implementar `agent/watchdog.sh`**

```bash
#!/usr/bin/env bash
# Rolls back a failed agent update. Run every minute by market77-watchdog.timer, as root.
# agent/update.ts writes "<previous-version> <deadline-epoch>" to $BASE/pending-update before it switches the
# "current" symlink, and the new agent deletes that file after its first successful heartbeat. If the file is
# still there after the deadline, the new version never came up: go back to the previous one.
set -euo pipefail

BASE="${M77_BASE:-/opt/market77}"
SYSTEMCTL="${M77_SYSTEMCTL:-systemctl}"
MARKER="$BASE/pending-update"

[ -f "$MARKER" ] || exit 0
read -r from deadline < "$MARKER" || true
[[ "${deadline:-}" =~ ^[0-9]+$ ]] || { rm -f "$MARKER"; exit 0; }
[ "$(date +%s)" -ge "$deadline" ] || exit 0

rm -f "$MARKER"
[[ "${from:-}" =~ ^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$ ]] || exit 0
[ -d "$BASE/releases/$from" ] || exit 0
ln -sfn "releases/$from" "$BASE/current"
"$SYSTEMCTL" restart market77-agent
```

Marcar como executável: `chmod +x agent/watchdog.sh`.

- [ ] **Step 5: Rodar os testes e o typecheck**

Run: `npx vitest run tests/agent && npm run typecheck`
Expected: PASS e sem erros de tipo.

- [ ] **Step 6: Commit**

```bash
git add agent/update.ts agent/watchdog.sh tests/agent/update.test.ts tests/agent/watchdog.test.ts
git commit -m "feat: add totem agent update with rollback watchdog"
```

---

### Task 11: Agente, ponto de entrada, empacotamento e instalação

**Files:**
- Create: `agent/main.ts`, `agent/install.sh`, `scripts/agent-package.ts`, `scripts/agent-release.ts`, `tests/agent/package.test.ts`, `tests/agent/scripts.test.ts`
- Modify: `package.json` (script `agent:release`)

**Interfaces:**
- Consumes: `createApi`, `createBrowser`, `parseConfig`, `createAgent`, `HEARTBEAT_MS`, `applyUpdate`, `confirmBoot`, `extractTar` (Tarefas 7 a 10).
- Produces: `buildAgentTarball(version: string, agentDir?: string): Promise<Buffer>` em `scripts/agent-package.ts` (o tarball tem `main.ts`, os módulos, `VERSION`, `package.json`, `install.sh`, `watchdog.sh` na raiz); `npm run agent:release -- <versão> <url-do-servidor>`; `node main.ts --check` imprime `ok`.

- [ ] **Step 1: Escrever os testes (falham)**

Criar `tests/agent/package.test.ts`:

```ts
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildAgentTarball } from "../../scripts/agent-package";

async function listing(data: Buffer) {
  const file = join(await mkdtemp(join(tmpdir(), "m77-pkg-")), "a.tgz");
  await writeFile(file, data);
  const names = execFileSync("tar", ["-tzf", file], { encoding: "utf8" }).split("\n").filter(Boolean);
  const version = execFileSync("tar", ["-xzOf", file, "./VERSION"], { encoding: "utf8" });
  return { names, version };
}

describe("agent tarball", () => {
  it("contains the agent files at the root and the version", async () => {
    const { names, version } = await listing(await buildAgentTarball("1.2.3"));
    for (const f of ["main.ts", "loop.ts", "api.ts", "browser.ts", "update.ts", "config.ts", "package.json", "install.sh", "watchdog.sh", "VERSION"]) {
      expect(names).toContain(`./${f}`);
    }
    expect(version).toBe("1.2.3\n");
    expect(names.some((n) => n.includes("node_modules") || n.includes("test"))).toBe(false);
  });

  it("is gzip and refuses a malformed version", async () => {
    const data = await buildAgentTarball("0.0.1");
    expect([data[0], data[1]]).toEqual([0x1f, 0x8b]);
    await expect(buildAgentTarball("../1.0.0")).rejects.toThrow(/invalid version/);
    await expect(buildAgentTarball("1.0")).rejects.toThrow(/invalid version/);
  });
});
```

Criar `tests/agent/scripts.test.ts`:

```ts
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const [major, minor] = process.versions.node.split(".").map(Number);
const stripsTypes = major > 22 || (major === 22 && minor >= 18);

describe("agent scripts", () => {
  it.skipIf(!stripsTypes)("loads under Node's type stripping (no build step on the totem)", () => {
    const r = spawnSync(process.execPath, ["agent/main.ts", "--check"], { encoding: "utf8" });
    expect([r.status, r.stdout.trim()]).toEqual([0, "ok"]);
  });

  it("has valid bash syntax", () => {
    for (const f of ["agent/install.sh", "agent/watchdog.sh"]) {
      const r = spawnSync("bash", ["-n", f], { encoding: "utf8" });
      expect([f, r.status, r.stderr]).toEqual([f, 0, ""]);
    }
  });

  const install = (...args: string[]) => spawnSync("bash", ["agent/install.sh", ...args], { encoding: "utf8" });
  const TOKEN = "YICrAdoFbgBTwO0isQT3ZfdQ_zgnKqNluOiuLwVXQXM";

  it("refuses missing arguments, a plain http server and a malformed token before touching the system", () => {
    expect([install().status, install().stderr]).toEqual([1, expect.stringMatching(/usage/)]);
    const http = install("http://x.com", TOKEN);
    expect([http.status, http.stderr]).toEqual([1, expect.stringMatching(/https/)]);
    const short = install("https://x.com", "short");
    expect([short.status, short.stderr]).toEqual([1, expect.stringMatching(/token/)]);
  });

  it.skipIf(process.getuid?.() === 0)("refuses to run without root", () => {
    const r = install("https://x.com", TOKEN);
    expect([r.status, r.stderr]).toEqual([1, expect.stringMatching(/root/)]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/agent/package.test.ts tests/agent/scripts.test.ts`
Expected: FAIL (`Cannot find module '../../scripts/agent-package'`, `agent/main.ts` e `agent/install.sh` inexistentes).

- [ ] **Step 3: `agent/main.ts`**

```ts
import { execFile, spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createApi } from "./api.ts";
import { createBrowser } from "./browser.ts";
import { parseConfig } from "./config.ts";
import { HEARTBEAT_MS, createAgent } from "./loop.ts";
import { applyUpdate, confirmBoot, extractTar } from "./update.ts";

// "node main.ts --check" only proves the files load under Node's type stripping (tests and install.sh use it).
if (process.argv[2] === "--check") {
  console.log("ok");
  process.exit(0);
}

const run = promisify(execFile);
const log = (message: string) => console.log(`${new Date().toISOString()} ${message}`);
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const baseDir = process.env.M77_BASE ?? "/opt/market77";

const config = parseConfig(await readFile(join(baseDir, "config.json"), "utf8"));
const version = (await readFile(new URL("./VERSION", import.meta.url), "utf8")).trim();
const api = createApi(config);

const browser = createBrowser(
  {
    command: config.browserCommand,
    url: `${config.serverUrl}/pdv#token=${config.token}`,
    profileDir: join(homedir(), ".config", "market77-pdv"),
  },
  {
    spawn: (command, args) => {
      const child = spawn(command, args, { stdio: "ignore" });
      return {
        kill: () => {
          child.kill();
        },
        on: (_event, cb) => {
          child.on("exit", () => cb());
          child.on("error", () => cb()); // for example a missing browser binary
        },
      };
    },
    schedule: (fn, ms) => setTimeout(fn, ms),
    cancel: (handle) => clearTimeout(handle as NodeJS.Timeout),
    now: () => Date.now(),
    log,
  },
);

const agent = createAgent({
  api,
  browser,
  version,
  sleep,
  log,
  system: {
    reboot: async () => {
      await run("sudo", ["-n", "systemctl", "reboot"]);
    },
    exit: () => process.exit(0),
  },
  update: {
    apply: (v, sha256) =>
      applyUpdate(
        {
          baseDir,
          currentVersion: version,
          download: (x) => api.downloadRelease(x),
          extract: extractTar,
          nowSeconds: () => Math.floor(Date.now() / 1000),
        },
        v,
        sha256,
      ),
    confirmBoot: () => confirmBoot(baseDir),
  },
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    browser.stop().finally(() => process.exit(0));
  });
}

browser.start();
log(`market77 agent ${version} started`);
for (;;) {
  let delay = HEARTBEAT_MS;
  try {
    delay = await agent.tick();
  } catch (e) {
    log(`tick failed: ${String(e)}`);
  }
  await sleep(delay);
}
```

- [ ] **Step 4: Empacotamento e publicação**

Criar `scripts/agent-package.ts`:

```ts
import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Packs agent/ plus a VERSION file into a gzip tarball with the files at its root. */
export async function buildAgentTarball(version: string, agentDir = "agent"): Promise<Buffer> {
  if (!/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(version)) throw new Error(`invalid version: ${version}`);
  const work = await mkdtemp(join(tmpdir(), "m77-agent-"));
  try {
    const stage = join(work, "stage");
    await cp(agentDir, stage, { recursive: true });
    await writeFile(join(stage, "VERSION"), `${version}\n`);
    const out = join(work, "agent.tgz");
    execFileSync("tar", ["-czf", out, "-C", stage, "."], { env: { ...process.env, COPYFILE_DISABLE: "1" } });
    return await readFile(out);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
```

Criar `scripts/agent-release.ts`:

```ts
import { buildAgentTarball } from "./agent-package";

const [version, server] = process.argv.slice(2);

async function main() {
  const secret = process.env.RELEASE_SECRET;
  if (!version || !server || !secret) {
    console.error("usage: npm run agent:release -- <version> <server-url>   (RELEASE_SECRET comes from .env)");
    process.exit(1);
  }
  const body = await buildAgentTarball(version);
  const res = await fetch(`${server.replace(/\/+$/, "")}/api/internal/releases`, {
    method: "POST",
    headers: { "x-release-secret": secret, "x-version": version, "content-type": "application/gzip" },
    body: new Uint8Array(body),
  });
  console.log(res.status, await res.text());
  process.exit(res.ok ? 0 : 1);
}
main();
```

Em `package.json`, acrescentar em `scripts`: `"agent:release": "tsx --env-file=.env scripts/agent-release.ts",`.

- [ ] **Step 5: `agent/install.sh`**

```bash
#!/usr/bin/env bash
# Installs the Market77 totem agent on Ubuntu. Run as root, from the extracted release folder:
#   curl -fsSL -H "Authorization: Bearer <token>" https://servidor/api/agent/releases/<versao> -o agent.tgz
#   mkdir agent && tar -xzf agent.tgz -C agent && cd agent && sudo ./install.sh https://servidor <token>
set -euo pipefail

SERVER="${1:-}"
TOKEN="${2:-}"
[ -n "$SERVER" ] && [ -n "$TOKEN" ] || { echo "usage: install.sh <server-url> <token>" >&2; exit 1; }
SERVER="${SERVER%/}"
[[ "$SERVER" =~ ^https://[A-Za-z0-9._:/-]+$ ]] || { echo "the server url must be https://..." >&2; exit 1; }
[[ "$TOKEN" =~ ^[A-Za-z0-9_-]{20,100}$ ]] || { echo "malformed token" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || { echo "run as root (sudo)" >&2; exit 1; }

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE=/opt/market77
[ -f "$SRC/main.ts" ] && [ -f "$SRC/VERSION" ] || { echo "run it from the extracted release folder" >&2; exit 1; }
VERSION="$(tr -d '[:space:]' < "$SRC/VERSION")"

# Node 22.18+ runs .ts files directly: the agent has no build step.
if ! command -v node >/dev/null 2>&1 \
  || ! node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=18)?0:1)'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
apt-get install -y chromium-browser
node "$SRC/main.ts" --check >/dev/null

id kiosk >/dev/null 2>&1 || useradd -m -s /bin/bash kiosk
KIOSK_UID="$(id -u kiosk)"

mkdir -p "$BASE/releases"
rm -rf "$BASE/releases/$VERSION"
cp -r "$SRC" "$BASE/releases/$VERSION"
ln -sfn "releases/$VERSION" "$BASE/current"
(umask 077; printf '{"serverUrl":"%s","token":"%s"}\n' "$SERVER" "$TOKEN" > "$BASE/config.json")
chown -R kiosk:kiosk "$BASE"

# The watchdog runs as root and lives outside the releases the agent can replace.
install -m 755 -o root -g root "$SRC/watchdog.sh" /usr/local/sbin/market77-watchdog

# The kiosk user may reboot the machine, and nothing else.
echo 'kiosk ALL=(root) NOPASSWD: /usr/bin/systemctl reboot' > /etc/sudoers.d/market77
chmod 440 /etc/sudoers.d/market77
visudo -cf /etc/sudoers.d/market77 >/dev/null || { rm -f /etc/sudoers.d/market77; echo "invalid sudoers rule" >&2; exit 1; }

# Ubuntu defaults to Wayland; the kiosk needs an X11 autologin session.
if [ -f /etc/gdm3/custom.conf ]; then
  sed -i '/^AutomaticLoginEnable=/d;/^AutomaticLogin=/d;/^WaylandEnable=/d' /etc/gdm3/custom.conf
  sed -i '/^\[daemon\]/a AutomaticLoginEnable=true\nAutomaticLogin=kiosk\nWaylandEnable=false' /etc/gdm3/custom.conf
else
  echo "warning: /etc/gdm3/custom.conf not found; configure autologin for 'kiosk' on X11 by hand" >&2
fi

cat > /etc/systemd/system/market77-agent.service <<EOF
[Unit]
Description=Market77 totem agent
After=network-online.target graphical.target
Wants=network-online.target

[Service]
User=kiosk
Environment=DISPLAY=:0
Environment=XAUTHORITY=/run/user/$KIOSK_UID/gdm/Xauthority
ExecStart=/usr/bin/node /opt/market77/current/main.ts
Restart=always
RestartSec=5

[Install]
WantedBy=graphical.target
EOF

cat > /etc/systemd/system/market77-watchdog.service <<'EOF'
[Unit]
Description=Market77 agent update watchdog

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/market77-watchdog
EOF

cat > /etc/systemd/system/market77-watchdog.timer <<'EOF'
[Unit]
Description=Market77 agent update watchdog

[Timer]
OnBootSec=1min
OnUnitActiveSec=1min

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable market77-agent
systemctl enable --now market77-watchdog.timer
echo "Agente $VERSION instalado. Reinicie o mini PC para entrar no modo kiosk."
```

Marcar como executável: `chmod +x agent/install.sh`.

- [ ] **Step 6: Rodar os testes, typecheck e suíte**

Run: `npx vitest run tests/agent && npm run typecheck && npm test`
Expected: PASS. O teste de `--check` prova que `agent/main.ts` e todos os módulos carregam só com remoção de tipos. Se ele falhar por `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`, o arquivo citado usa `enum`, `namespace` ou parameter property: reescrever sem isso.

- [ ] **Step 7: Commit**

```bash
git add agent scripts tests/agent package.json
git commit -m "feat: add totem agent entry point, release packaging and installer"
```

---

### Task 12: Documentação e verificação final

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: tudo das Tarefas 1 a 11.

- [ ] **Step 1: Atualizar o `README.md`**

Acrescentar, depois da seção "Totem (fase 2)" e antes de "Testes", e trocar na seção da fase 2 a frase "que será agendada na fase 3" por "que um agendador deve chamar a cada minuto em produção (veja abaixo)":

````markdown
## Agente do totem (fase 3)

O agente roda no mini PC (Ubuntu): abre o PDV em tela cheia, envia um heartbeat a cada 30 s e executa os comandos que o dono manda pelo painel (**Totens**: Reiniciar PDV, Reboot, Atualizar agente). O servidor nunca conecta no totem; o agente é quem pergunta.

**Publicar uma versão do agente** (no servidor ou na sua máquina, com `RELEASE_SECRET` no `.env`):

```bash
npm run agent:release -- 1.0.0 https://seu-servidor
```

**Instalar em um totem:** cadastre o totem no painel e copie o token. No mini PC:

```bash
curl -fsSL -H "Authorization: Bearer <token>" https://seu-servidor/api/agent/releases/1.0.0 -o agent.tgz
mkdir agent && tar -xzf agent.tgz -C agent && cd agent
sudo ./install.sh https://seu-servidor <token>
sudo reboot
```

O instalador coloca Node 22.18+ e o Chromium, cria o usuário `kiosk` (autologin em X11), a regra `sudoers` só para `systemctl reboot`, o serviço `market77-agent` e o `market77-watchdog`, que volta à versão anterior se uma atualização não der heartbeat em 2 minutos.

**Atualizar:** publique uma versão nova com `agent:release` e use **Atualizar agente** no painel. O agente baixa o pacote, confere o SHA-256, troca a versão e reinicia sozinho.

Um totem sem batida há mais de 2 minutos aparece como **offline** (o painel também mostra a contagem). Um comando que fica mais de 10 minutos na fila expira e nunca roda depois.

**Em produção (Firebase App Hosting, Cloud Run ou outra hospedagem sem cron):** agende uma chamada por minuto, por exemplo no Cloud Scheduler:

```bash
curl -X POST https://seu-servidor/api/internal/reconcile -H "x-reconcile-secret: $RECONCILE_SECRET"
```

O pacote do agente fica no Postgres (limite de 20 MB). Variáveis novas: `RELEASE_SECRET` (publicar pacote).
````

- [ ] **Step 2: Verificação automática completa**

Run: `npm run typecheck && npm test && npm run build`
Expected: tudo passa. Registre a contagem de arquivos e testes.

- [ ] **Step 3: Roteiro HTTP com servidor real**

Com `docker compose up -d`, `.env` completo (com `RELEASE_SECRET`), `npm run db:migrate` e `npm run dev -- -p 3457` em segundo plano. Crie os dados com scripts descartáveis FORA do repositório (pasta de rascunho da sessão; apague-os depois). Os dois fecham os pools no fim.

`seed.ts`:

```ts
import { addMember, login, signUp } from "/CAMINHO/DO/REPO/src/auth/service";
import { adminSql, appSql } from "/CAMINHO/DO/REPO/src/db/client";
import { withOrg } from "/CAMINHO/DO/REPO/src/db/tenant";
import { createMarket } from "/CAMINHO/DO/REPO/src/domain/markets";
import { createTerminal } from "/CAMINHO/DO/REPO/src/domain/terminals";

(async () => {
  const s = Date.now();
  const owner = await signUp({ email: `ana${s}@x.com`, password: "senha-forte-1", orgName: "Mercados Ana" });
  const market = await withOrg(owner.orgId, (tx) => createMarket(tx, owner.orgId, { name: "Loja Bloco 1" }));
  const term = await withOrg(owner.orgId, (tx) =>
    createTerminal(tx, owner.orgId, { marketId: market.id, name: "Totem 1" }),
  );
  await addMember(owner.orgId, { email: `rep${s}@x.com`, password: "senha-rep-123", role: "restocker" });
  const rep = await login({ email: `rep${s}@x.com`, password: "senha-rep-123" });
  const stranger = await signUp({ email: `bia${s}@x.com`, password: "senha-bia-123", orgName: "Bia" });
  console.log(JSON.stringify({
    org: owner.orgId, user: owner.userId, terminalId: term.id, terminal: term.token,
    owner: owner.token, rep: rep.token, stranger: stranger.token,
  }));
  await adminSql.end();
  await appSql.end();
})();
```

`send.ts` (cria um comando como o painel faria; argumentos: org, usuário, totem, tipo, versão opcional):

```ts
import { adminSql, appSql } from "/CAMINHO/DO/REPO/src/db/client";
import { withOrg } from "/CAMINHO/DO/REPO/src/db/tenant";
import { createCommand } from "/CAMINHO/DO/REPO/src/domain/agent";

(async () => {
  const [org, user, terminalId, type, version] = process.argv.slice(2);
  const id = await withOrg(org, (tx) => createCommand(tx, org, user, { terminalId, type, version }, new Date()));
  console.log(id);
  await adminSql.end();
  await appSql.end();
})();
```

Executar com `npx tsx --env-file=.env <script>`. Depois, com `curl` (substituindo os valores impressos), conferir e registrar o comando e a saída crua de cada item:

1. `POST /api/agent/heartbeat` sem `Authorization` retorna 401. Com `Authorization: Bearer <terminal>` e corpo `{"agentVersion":"1.0.0","pdvStatus":"running"}` retorna 200 `{"command":null}`. Corpo `{` retorna 400.
2. Painel com `m77_session=<owner>`: `GET /o/<org>/terminals` retorna 200 e contém "online", "1.0.0" e "Reiniciar PDV".
3. `npm run agent:release -- 1.0.0 http://localhost:3457` imprime `201` com `sha256`; repetir imprime `409`. Sem `RELEASE_SECRET` correto (`curl` com `x-release-secret: errado`) retorna 401.
4. `send.ts <org> <user> <terminalId> restart_pdv`; o heartbeat seguinte devolve `command` com `type: "restart_pdv"`; um segundo heartbeat devolve `command: null`; `POST /api/agent/commands/<id>/result` com `{"ok":true}` retorna 200 e repetir retorna 200.
5. `send.ts ... update 1.0.0`; o heartbeat devolve `version` e `sha256`; `GET /api/agent/releases/1.0.0` com o token do totem retorna o arquivo e o cabeçalho `x-sha256` igual; `shasum -a 256` do arquivo baixado é igual ao `sha256` do comando. Finalize o comando com `{"ok":true}`.
6. `GET /api/agent/releases/9.9.9` e `/api/agent/releases/..%2Fx` retornam 404; `POST /api/agent/commands/nope/result` retorna 404.
7. Isolamento: `GET /o/<org>/terminals` com o cookie do repositor e com o do estranho retorna 404; com o do estranho a resposta não contém "Mercados Ana".
8. Offline: `docker compose exec db psql -U market77 market77 -c "update terminals set last_heartbeat_at = now() - interval '5 minutes'"`; `GET /o/<org>/terminals` contém "offline" e `GET /o/<org>` contém "offline".
9. Revogação: revogar o totem (SQL: `update terminals set revoked_at = now()`); o heartbeat retorna 401 com `terminal_revoked`.
10. Reiniciar o servidor e repetir o item 2: continua 200.

Encerrar o servidor (`pkill -f "next dev"`), apagar os scripts descartáveis e conferir que nada ficou rodando (`pgrep -fl "next|tsx"` vazio) e que `git status` está limpo.

- [ ] **Step 4: Roteiro manual no mini PC (feito pelo dono do projeto; o implementador não tem o hardware)**

1. Publicar a versão 1.0.0 e instalar no mini PC como descrito no README; reiniciar. O PDV abre sozinho em tela cheia, sem colar token.
2. No painel, o totem aparece **online** com versão 1.0.0 e PDV aberto.
3. Desligar o Wi-Fi: o PDV mostra "Totem indisponível" e o painel passa a **offline** em até 2 minutos. Religar: tudo volta sozinho.
4. **Reiniciar PDV**: o navegador fecha e reabre; o histórico mostra "Concluído".
5. Fechar o Chromium à mão (`pkill chromium`): ele reabre sozinho.
6. **Reboot**: a máquina reinicia uma única vez, volta sozinha, e o histórico mostra "Concluído" (sem um segundo reboot).
7. Publicar a versão 1.0.1 e usar **Atualizar agente**: o agente reinicia na nova versão (coluna Agente mostra 1.0.1) e `ls /opt/market77/releases` mostra 1.0.0 e 1.0.1.
8. Publicar uma versão 1.0.2 quebrada (por exemplo, com `main.ts` que dá erro na primeira linha) e atualizar: em até 3 minutos o watchdog volta à 1.0.1 e o painel mostra a versão 1.0.1 de novo.
9. Confirmar que o autologin entra em X11 (`echo $XDG_SESSION_TYPE` mostra `x11`) e que a regra `sudoers` permite só `reboot` (`sudo -u kiosk sudo -n systemctl reboot` funciona; `sudo -u kiosk sudo -n ls` pede senha).

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: document phase 3 totem agent, releases and scheduler"
```

---

## Auto-revisão

**Cobertura do spec:** seção 3 (modelo de dados) na Tarefa 1; seção 4 (API) nas Tarefas 3 e 4; seção 5 (painel) na Tarefa 5, com a contagem de offline também no painel inicial; seção 6 (agente) nas Tarefas 7 a 11, incluindo token por fragmento (Tarefa 6), rollback e instalação; seção 7 (reconciliação) no README da Tarefa 12; seção 8 (erros) coberta pelos testes das Tarefas 2, 4, 9 e 10; seção 9 (testes) distribuída, com o roteiro manual no hardware na Tarefa 12.

**Desvio do spec, a confirmar na revisão:** o histórico do painel mostra "quem pediu" pelo e-mail, resolvido por `userEmails` (`adminSql`, em `src/auth/service.ts`), porque o papel da aplicação não lê `users`. O spec não citava essa consulta.
