# Fase 6: Registro de acessos (leitor facial simulado) - Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O dono vê quem entra no mercado e quando: um leitor facial manda cada entrada por uma API com token, o Market77 sincroniza o cadastro de pessoas com o leitor, guarda os eventos por 90 dias, mostra o nome da pessoa e cruza as entradas com as vendas por dia. Nunca guarda imagem nem template facial.

**Architecture:** Monólito Next.js sobre as fases 1 a 5B. Eventos por push em `POST /api/access/events` (token por leitor, o mercado vem do token); pessoas por pull, pela interface `AccessProvider` com o adaptador simulado `fake-access`; sincronização e retenção rodam na chamada de cada minuto da rota `POST /api/internal/reconcile`. Painel só para o dono (`access:read` e `access:write`).

**Tech Stack:** Next.js 15, React 19, TypeScript, Postgres 16, `postgres` (postgres.js), `zod`, `vitest`, `tsx` (todos já instalados). Nenhuma dependência nova.

**Spec:** `docs/superpowers/specs/2026-10-05-fase-6-acesso-design.md` (spec geral: `docs/superpowers/specs/2026-10-01-market77-design.md`)

## Global Constraints

- Stack: Next.js + TypeScript, Postgres com Row Level Security; migrations em SQL puro, sem ORM. Nenhuma dependência nova. Só a migration `0008_access.sql` muda o banco.
- Todo acesso a dados de negócio passa por `withOrg()`. O `adminSql` só descobre leitor e organização (token do leitor, leitores vencidos na sincronização) e apaga eventos vencidos na retenção.
- O Market77 nunca guarda imagem nem template facial. A ingestão aceita só `occurredAt`, `eventId`, `personId` e `kind`; qualquer outro campo é descartado (o `zod` remove chaves desconhecidas). Não existe coluna de payload livre.
- O mercado de um evento vem do token do leitor, nunca do corpo da chamada. Token: 32 bytes em base64url, mostrado uma vez; só o SHA-256 é guardado.
- Janela de aceitação de `occurredAt`: no máximo 5 minutos no futuro (`MAX_FUTURE_MS`) e no máximo 7 dias no passado (`MAX_PAST_MS`), medida contra o `now` recebido.
- Sincronização: um leitor não revogado é sincronizado quando `last_sync_at` é nulo ou tem 10 minutos ou mais (`SYNC_INTERVAL_MS`); cada tentativa grava `last_sync_at = now`. Sucesso grava `last_sync_error = null`; falha (provedor ou SQL) grava o erro (até 200 caracteres) e mantém a lista antiga. Lista vazia é válida e desativa todas as pessoas do leitor. Pessoa esquecida nunca é recriada nem reativada.
- Retenção: `ACCESS_RETENTION_DAYS = 90` a partir do `now` recebido, em lotes (`limit = 5000`), com `adminSql`. O papel da aplicação não tem `DELETE` em nenhuma tabela de acesso.
- Dia ou hora de qualquer resumo é a data civil no fuso do mercado (`markets.timezone`), nunca UTC.
- Só o dono tem `access:read` e `access:write` (gerente e repositor não veem o nome de quem entra).
- Entradas ruins nunca dão 500: JSON quebrado, campos inválidos, token ruim e `?day=` inválido viram 400, 401 ou 404. O adaptador `fake-access` e as rotas `/api/dev/fake-access/...` recusam `NODE_ENV=production`.
- Interface em português do Brasil. Nenhum emoji em código, commits ou arquivos.
- Comportamento de Pix, cartão, lote e validade, NFC-e e todos os testes existentes continuam como estão (únicas edições em testes existentes: a resposta da rota `reconcile` ganha o campo `access`).
- Fora desta fase: abrir a porta, câmeras, imagem ou template facial, eventos além de entrada, eventos puxados do equipamento, provedor real, alertas em tempo real, deduplicar a mesma pessoa entre leitores.

## Review Focus

1. Evento de um leitor entra sempre no mercado e na organização dele, e nunca guarda campo extra; token ausente, errado ou revogado não grava nada (Tarefas 3 e 4).
2. Esquecer pessoa: nome apagado, identificador anulado nos eventos antigos, evento novo entra anônimo e a sincronização não recria nem reativa (Tarefas 4, 5 e 6).
3. Sincronização: equipamento fora do ar, erro de SQL no meio, dois processadores ao mesmo tempo, lista vazia e entrada inválida nunca perdem histórico nem deixam um leitor preso; limite de 10 minutos (Tarefa 5).
4. Fuso: evento perto da meia-noite cai no dia certo do mercado, e as vendas pagas do mesmo dia entram no cruzamento (Tarefa 7).
5. Só o dono vê nomes: gerente e repositor recebem 404; outra organização não vê nada (Tarefas 3, 7 e 8).
6. Retenção apaga só o que passou de 90 dias do `now` recebido, em lotes, e o app não consegue apagar eventos (Tarefas 1 e 6).

---

## Estrutura de arquivos

```
src/db/migrations/0008_access.sql               # access_sources, access_people, access_events
src/access/provider.ts                          # AccessProvider, AccessUnavailable
src/access/fake-access.ts                       # adaptador simulado (lista por leitor, modo ok/down)
src/access/registry.ts                          # getAccessProvider
src/access/auth.ts                              # requireSource (token do leitor)
src/access/http.ts                              # eventHandler e respostas de erro da ingestão
src/app/api/access/events/route.ts              # POST /api/access/events
src/app/api/dev/fake-access/people/route.ts, mode/route.ts
src/domain/access.ts                            # leitores, eventos, sincronização, retenção, esquecer, leituras
src/auth/permissions.ts                         # access:read, access:write (dono)
src/app/api/internal/reconcile/route.ts         # roda as três filas
src/app/o/[orgId]/markets/[marketId]/access/page.tsx, actions.ts, AccessSourceForm.tsx
src/app/o/[orgId]/markets/[marketId]/page.tsx   # link para Acessos
tests/helpers.ts                                # seedAccessSource, seedPerson, seedAccessEvent
tests/db/access-schema.test.ts
tests/access/access-contract.ts, fake-access.test.ts, ingestion.test.ts, sync.test.ts
tests/domain/access-sources.test.ts, access-retention.test.ts, access-reads.test.ts
tests/auth/access-permissions.test.ts
tests/pdv/reconcile-access.test.ts
README.md
```

---

### Task 1: Migration 0008 e helpers de teste

**Files:**
- Create: `src/db/migrations/0008_access.sql`
- Create: `tests/db/access-schema.test.ts`
- Modify: `tests/helpers.ts`

**Interfaces:**
- Consumes: `markets (id, org_id)` único; helpers `seedStore`, `makeOrg`.
- Produces: tabelas da spec seção 3; helpers de teste `seedAccessSource(orgId, marketId, { name?, token?, revoked? }): Promise<{ id: string; token: string }>` (insere pelo SQL do administrador, guardando o SHA-256 do token; token padrão aleatório), `seedPerson(orgId, sourceId, externalId, name, { active?, forgotten? }): Promise<string>` e `seedAccessEvent(orgId, marketId, sourceId, { at: Date; personId?: string | null; eventId?: string | null }): Promise<string>`.

- [ ] **Step 1: Escrever o teste do schema**

Criar `tests/db/access-schema.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { adminSql } from "@/db/client";
import { withOrg } from "@/db/tenant";
import { makeOrg, resetDb, seedAccessEvent, seedAccessSource, seedPerson, seedStore } from "../helpers";

beforeEach(resetDb);

const AT = new Date("2026-10-05T12:00:00Z");

async function setup(name = "A") {
  const orgId = await makeOrg(name);
  const { marketId } = await seedStore(orgId);
  const source = await seedAccessSource(orgId, marketId);
  return { orgId, marketId, source };
}

describe("phase 6 schema", () => {
  it("refuses malformed values", async () => {
    const { orgId, marketId, source } = await setup();
    const bad = (q: Promise<unknown>) => expect(q).rejects.toThrow(/check/);
    await bad(adminSql`update access_sources set name = 'x' where id = ${source.id}`);
    await bad(seedPerson(orgId, source.id, "", "Ana"));
    await bad(seedPerson(orgId, source.id, "u1", ""));
    await bad(
      adminSql`insert into access_events (org_id, market_id, source_id, occurred_at, kind)
        values (${orgId}, ${marketId}, ${source.id}, ${AT}, 'exit')`,
    );
    await bad(seedAccessEvent(orgId, marketId, source.id, { at: AT, personId: "p".repeat(65) }));
  });

  it("keeps one person per reader and one event id per reader", async () => {
    const { orgId, marketId, source } = await setup();
    await seedPerson(orgId, source.id, "u1", "Ana");
    await expect(seedPerson(orgId, source.id, "u1", "Outra")).rejects.toThrow(/duplicate key/);
    await seedAccessEvent(orgId, marketId, source.id, { at: AT, eventId: "e1" });
    await expect(seedAccessEvent(orgId, marketId, source.id, { at: AT, eventId: "e1" })).rejects.toThrow(
      /duplicate key/,
    );
    await seedAccessEvent(orgId, marketId, source.id, { at: AT }); // no event id: repeats are fine
    await seedAccessEvent(orgId, marketId, source.id, { at: AT });
    const other = await seedAccessSource(orgId, marketId);
    await seedAccessEvent(orgId, marketId, other.id, { at: AT, eventId: "e1" }); // same id, other reader
  });

  it("accepts a forgotten person with no name", async () => {
    const { orgId, source } = await setup();
    const id = await seedPerson(orgId, source.id, "u1", "Ana");
    await adminSql`update access_people set name = null, forgotten_at = now() where id = ${id}`;
  });

  it("isolates the tables per tenant", async () => {
    const a = await setup("A");
    const b = await makeOrg("B");
    await seedPerson(a.orgId, a.source.id, "u1", "Ana");
    await seedAccessEvent(a.orgId, a.marketId, a.source.id, { at: AT });
    for (const t of ["access_sources", "access_people", "access_events"]) {
      expect(await withOrg(b, (tx) => tx.unsafe(`select id from ${t}`))).toEqual([]);
      expect(await withOrg(a.orgId, (tx) => tx.unsafe(`select id from ${t}`))).toHaveLength(1);
    }
  });

  it("lets the app role update but never delete access rows", async () => {
    const { orgId, marketId, source } = await setup();
    await seedPerson(orgId, source.id, "u1", "Ana");
    await seedAccessEvent(orgId, marketId, source.id, { at: AT });
    await withOrg(orgId, (tx) => tx`update access_sources set last_sync_error = 'x'`);
    await withOrg(orgId, (tx) => tx`update access_people set active = false`);
    await withOrg(orgId, (tx) => tx`update access_events set person_external_id = null`);
    for (const t of ["access_sources", "access_people", "access_events"]) {
      await expect(withOrg(orgId, (tx) => tx.unsafe(`delete from ${t}`))).rejects.toThrow(/permission denied/);
    }
  });
});
```

- [ ] **Step 2: Acrescentar os helpers em `tests/helpers.ts`**

Acrescentar `import { createHash, randomUUID } from "node:crypto";` (juntando com o `randomUUID` já importado do mesmo módulo). Na lista `TABLES`, inserir `"access_events", "access_people", "access_sources",` no começo. Antes de `codeOf`, acrescentar:

```ts
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** A reader (access source) of a market. The plain token is returned so tests can authenticate with it. */
export async function seedAccessSource(
  orgId: string,
  marketId: string,
  o: { name?: string; token?: string; revoked?: boolean } = {},
): Promise<{ id: string; token: string }> {
  const token = o.token ?? randomUUID();
  const [s] = await adminSql`
    insert into access_sources (org_id, market_id, name, token_hash, revoked_at)
    values (${orgId}, ${marketId}, ${o.name ?? "Leitor 1"}, ${sha256(token)}, ${o.revoked ? new Date() : null})
    returning id`;
  return { id: s.id as string, token };
}

export async function seedPerson(
  orgId: string,
  sourceId: string,
  externalId: string,
  name: string,
  o: { active?: boolean; forgotten?: boolean } = {},
): Promise<string> {
  const [p] = await adminSql`
    insert into access_people (org_id, source_id, external_id, name, active, forgotten_at)
    values (${orgId}, ${sourceId}, ${externalId}, ${o.forgotten ? null : name}, ${o.active ?? true},
      ${o.forgotten ? new Date() : null})
    returning id`;
  return p.id as string;
}

export async function seedAccessEvent(
  orgId: string,
  marketId: string,
  sourceId: string,
  o: { at: Date; personId?: string | null; eventId?: string | null },
): Promise<string> {
  const [e] = await adminSql`
    insert into access_events (org_id, market_id, source_id, occurred_at, person_external_id, event_id)
    values (${orgId}, ${marketId}, ${sourceId}, ${o.at}, ${o.personId ?? null}, ${o.eventId ?? null})
    returning id`;
  return e.id as string;
}
```

- [ ] **Step 3: Rodar o teste e ver falhar**

Run: `npx vitest run tests/db/access-schema.test.ts`
Expected: FAIL (tabelas não existem).

- [ ] **Step 4: Escrever a migration `src/db/migrations/0008_access.sql`**

```sql
-- Phase 6: access log. Readers push entry events; the list of people is pulled from the reader.
-- No face image or template is ever stored: only the opaque person id the reader sends.
CREATE TABLE access_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  market_id uuid NOT NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 60),
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  last_sync_at timestamptz,
  last_sync_error text,
  last_event_at timestamptz,
  UNIQUE (id, org_id),
  FOREIGN KEY (market_id, org_id) REFERENCES markets (id, org_id)
);

CREATE TABLE access_people (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  source_id uuid NOT NULL,
  external_id text NOT NULL CHECK (char_length(external_id) BETWEEN 1 AND 64),
  name text CHECK (name IS NULL OR char_length(name) BETWEEN 1 AND 120),
  active boolean NOT NULL DEFAULT true,
  forgotten_at timestamptz,
  synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, external_id),
  UNIQUE (id, org_id),
  FOREIGN KEY (source_id, org_id) REFERENCES access_sources (id, org_id)
);

CREATE TABLE access_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  market_id uuid NOT NULL,
  source_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL DEFAULT 'entry' CHECK (kind IN ('entry')),
  person_external_id text CHECK (person_external_id IS NULL OR char_length(person_external_id) BETWEEN 1 AND 64),
  event_id text CHECK (event_id IS NULL OR char_length(event_id) BETWEEN 1 AND 64),
  FOREIGN KEY (source_id, org_id) REFERENCES access_sources (id, org_id),
  FOREIGN KEY (market_id, org_id) REFERENCES markets (id, org_id)
);
CREATE UNIQUE INDEX access_events_dedupe_idx ON access_events (source_id, event_id) WHERE event_id IS NOT NULL;
CREATE INDEX access_events_market_idx ON access_events (market_id, occurred_at);
CREATE INDEX access_events_time_idx ON access_events (occurred_at);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['access_sources', 'access_people', 'access_events']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON %I
        USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid)
        WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid)$p$, t);
  END LOOP;
END $$;

-- No DELETE for the app role: retention deletes with the admin role, forgetting a person is an UPDATE.
GRANT SELECT, INSERT, UPDATE ON access_sources, access_people, access_events TO market77_app;
```

- [ ] **Step 5: Rodar o teste e a suíte**

Run: `npx vitest run tests/db/access-schema.test.ts && npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/db/migrations/0008_access.sql tests/db/access-schema.test.ts tests/helpers.ts
git commit -m "feat: add phase 6 schema for the access log"
```

---

### Task 2: Provedor de acesso (interface, simulador, registro, rotas de dev)

**Files:**
- Create: `src/access/provider.ts`, `src/access/fake-access.ts`, `src/access/registry.ts`
- Create: `src/app/api/dev/fake-access/people/route.ts`, `src/app/api/dev/fake-access/mode/route.ts`
- Create: `tests/access/access-contract.ts`, `tests/access/fake-access.test.ts`
- Modify: `.env.example`, `vitest.config.ts`

**Interfaces:**
- Produces (`provider.ts`): `type AccessPerson = { externalId: string; name: string }`, `type AccessSourceRef = { id: string; marketId: string; name: string }`, `class AccessUnavailable extends Error`, `interface AccessProvider { name: string; listPeople(source: AccessSourceRef): Promise<AccessPerson[]> }`.
- Produces (`fake-access.ts`): `fakeAccessProvider`, `setFakePeople(sourceId: string, people: AccessPerson[]): void`, `setFakeAccessMode(mode: "ok" | "down"): void`, `resetFakeAccess(): void`.
- Produces (`registry.ts`): `getAccessProvider(name?: string): AccessProvider` (desconhecido lança `AppError("provider_unavailable")`).
- Produces (`tests/access/access-contract.ts`): `accessProviderContract(name, make)` com `make: () => { provider: AccessProvider; setPeople(source: AccessSourceRef, people: AccessPerson[]): void }`.

- [ ] **Step 1: Escrever a suíte de contrato e o teste do simulador**

Criar `tests/access/access-contract.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { AccessPerson, AccessProvider, AccessSourceRef } from "@/access/provider";

export type AccessHarness = {
  provider: AccessProvider;
  /** Makes the reader report exactly these people. */
  setPeople(source: AccessSourceRef, people: AccessPerson[]): void;
};

/** Every access adapter must pass this suite (the real one runs it against its sandbox). */
export function accessProviderContract(name: string, make: () => AccessHarness) {
  describe(`access provider contract: ${name}`, () => {
    const a: AccessSourceRef = { id: "source-a", marketId: "market-1", name: "Porta A" };
    const b: AccessSourceRef = { id: "source-b", marketId: "market-1", name: "Porta B" };

    it("lists the people the reader reports, as plain id and name strings", async () => {
      const h = make();
      h.setPeople(a, [
        { externalId: "u1", name: "Ana" },
        { externalId: "u2", name: "Bia" },
      ]);
      const people = await h.provider.listPeople(a);
      expect(people).toEqual([
        { externalId: "u1", name: "Ana" },
        { externalId: "u2", name: "Bia" },
      ]);
    });

    it("returns an empty list for a reader with no people", async () => {
      expect(await make().provider.listPeople(a)).toEqual([]);
    });

    it("keeps the lists of different readers apart", async () => {
      const h = make();
      h.setPeople(a, [{ externalId: "u1", name: "Ana" }]);
      h.setPeople(b, [{ externalId: "u9", name: "Zé" }]);
      expect((await h.provider.listPeople(a)).map((p) => p.externalId)).toEqual(["u1"]);
      expect((await h.provider.listPeople(b)).map((p) => p.externalId)).toEqual(["u9"]);
    });
  });
}
```

Criar `tests/access/fake-access.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as modeRoute } from "@/app/api/dev/fake-access/mode/route";
import { POST as peopleRoute } from "@/app/api/dev/fake-access/people/route";
import { fakeAccessProvider, resetFakeAccess, setFakeAccessMode, setFakePeople } from "@/access/fake-access";
import { AccessUnavailable } from "@/access/provider";
import { getAccessProvider } from "@/access/registry";
import { AppError } from "@/lib/errors";
import { accessProviderContract } from "./access-contract";

beforeEach(() => resetFakeAccess());
afterEach(() => vi.unstubAllEnvs());

accessProviderContract("fake", () => {
  resetFakeAccess();
  return { provider: fakeAccessProvider, setPeople: (s, p) => setFakePeople(s.id, p) };
});

const SRC = { id: "s1", marketId: "m1", name: "Porta" };

describe("fake access modes", () => {
  it("down: listing fails as unavailable", async () => {
    setFakeAccessMode("down");
    await expect(fakeAccessProvider.listPeople(SRC)).rejects.toBeInstanceOf(AccessUnavailable);
    setFakeAccessMode("ok");
    await expect(fakeAccessProvider.listPeople(SRC)).resolves.toEqual([]);
  });

  it("hands out copies, so callers cannot change the stored list", async () => {
    setFakePeople("s1", [{ externalId: "u1", name: "Ana" }]);
    (await fakeAccessProvider.listPeople(SRC))[0].name = "Mudou";
    expect((await fakeAccessProvider.listPeople(SRC))[0].name).toBe("Ana");
  });

  it("refuses to run in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(fakeAccessProvider.listPeople(SRC)).rejects.toThrow(/production/);
  });
});

describe("registry", () => {
  it("resolves the fake provider and turns an unknown name into provider_unavailable", () => {
    expect(getAccessProvider("fake")).toBe(fakeAccessProvider);
    for (const name of ["nope", "constructor", "__proto__"]) {
      expect(() => getAccessProvider(name)).toThrow(AppError);
    }
  });
});

describe("dev routes", () => {
  const post = (route: (r: Request) => Promise<Response>, body: unknown, raw?: string) =>
    route(new Request("http://m77.test/x", { method: "POST", body: raw ?? JSON.stringify(body) }));

  it("sets the people of a reader and rejects bad input", async () => {
    const ok = await post(peopleRoute, { sourceId: "s1", people: [{ externalId: "u1", name: "Ana" }] });
    expect([ok.status, await ok.json()]).toEqual([200, { count: 1 }]);
    expect(await fakeAccessProvider.listPeople(SRC)).toEqual([{ externalId: "u1", name: "Ana" }]);
    expect((await post(peopleRoute, { sourceId: "s1", people: [{ externalId: "", name: "x" }] })).status).toBe(400);
    expect((await post(peopleRoute, { people: [] })).status).toBe(400);
    expect((await post(peopleRoute, undefined, "{")).status).toBe(400);
  });

  it("switches the mode, rejects bad input and is a 404 in production", async () => {
    const ok = await post(modeRoute, { mode: "down" });
    expect([ok.status, await ok.json()]).toEqual([200, { mode: "down" }]);
    await expect(fakeAccessProvider.listPeople(SRC)).rejects.toBeInstanceOf(AccessUnavailable);
    expect((await post(modeRoute, { mode: "boom" })).status).toBe(400);
    expect((await post(modeRoute, undefined, "{")).status).toBe(400);
    vi.stubEnv("NODE_ENV", "production");
    expect((await post(modeRoute, { mode: "ok" })).status).toBe(404);
    expect((await post(peopleRoute, { sourceId: "s1", people: [] })).status).toBe(404);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/access`
Expected: FAIL (módulos não existem).

- [ ] **Step 3: Escrever `src/access/provider.ts`**

```ts
export type AccessPerson = { externalId: string; name: string };
export type AccessSourceRef = { id: string; marketId: string; name: string };

/** The reader is down or too slow: keep the old list and try again later. */
export class AccessUnavailable extends Error {
  constructor(message = "access reader unavailable") {
    super(message);
    this.name = "AccessUnavailable";
  }
}

export interface AccessProvider {
  name: string;
  /** Everyone the reader currently has registered. The Market77 never receives faces, only ids and names. */
  listPeople(source: AccessSourceRef): Promise<AccessPerson[]>;
}
```

- [ ] **Step 4: Escrever `src/access/fake-access.ts`**

```ts
import { AccessUnavailable, type AccessPerson, type AccessProvider } from "./provider";

export type FakeAccessMode = "ok" | "down";

// ponytail: state lives in memory, for dev and tests only. A real adapter asks its reader instead.
const g = globalThis as unknown as {
  __m77fakeAccess?: { mode: FakeAccessMode; people: Map<string, AccessPerson[]> };
};
const state = (g.__m77fakeAccess ??= { mode: "ok", people: new Map() });

function guard(): void {
  if (process.env.NODE_ENV === "production") throw new Error("fake access provider is disabled in production");
}

export function setFakePeople(sourceId: string, people: AccessPerson[]): void {
  guard();
  state.people.set(sourceId, people.map((p) => ({ ...p })));
}

export function setFakeAccessMode(mode: FakeAccessMode): void {
  guard();
  state.mode = mode;
}

/** Tests: forget every list and go back to "ok". */
export function resetFakeAccess(): void {
  guard();
  state.mode = "ok";
  state.people.clear();
}

export const fakeAccessProvider: AccessProvider = {
  name: "fake",

  async listPeople(source) {
    guard();
    if (state.mode === "down") throw new AccessUnavailable();
    return (state.people.get(source.id) ?? []).map((p) => ({ ...p }));
  },
};
```

- [ ] **Step 5: Escrever `src/access/registry.ts`, as rotas e o ambiente**

`src/access/registry.ts`:

```ts
import { AppError } from "@/lib/errors";
import { fakeAccessProvider } from "./fake-access";
import type { AccessProvider } from "./provider";

const PROVIDERS: Record<string, AccessProvider> = { fake: fakeAccessProvider };

// ponytail: one global provider chosen by env. Per-organization selection arrives with provider_credentials.
export function getAccessProvider(name: string = process.env.ACCESS_PROVIDER ?? "fake"): AccessProvider {
  // hasOwn: the name may come from outside, so "constructor" must not resolve to Object.prototype members.
  if (!Object.hasOwn(PROVIDERS, name)) throw new AppError("provider_unavailable");
  return PROVIDERS[name];
}
```

`src/app/api/dev/fake-access/people/route.ts`:

```ts
import { z } from "zod";
import { setFakePeople } from "@/access/fake-access";

const Body = z.object({
  sourceId: z.string().min(1),
  people: z
    .array(z.object({ externalId: z.string().min(1).max(64), name: z.string().min(1).max(120) }))
    .max(5000),
});

/** Dev only: sets the people a simulated reader reports. */
export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") return new Response(null, { status: 404 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_input" }, { status: 400 });
  setFakePeople(parsed.data.sourceId, parsed.data.people);
  return Response.json({ count: parsed.data.people.length });
}
```

`src/app/api/dev/fake-access/mode/route.ts`:

```ts
import { z } from "zod";
import { setFakeAccessMode } from "@/access/fake-access";

const Body = z.object({ mode: z.enum(["ok", "down"]) });

/** Dev only: switches the simulated reader between ok and down. */
export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") return new Response(null, { status: 404 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_input" }, { status: 400 });
  setFakeAccessMode(parsed.data.mode);
  return Response.json({ mode: parsed.data.mode });
}
```

Em `.env.example`, acrescentar `ACCESS_PROVIDER=fake`. Em `vitest.config.ts`, no objeto `env`, acrescentar `ACCESS_PROVIDER: "fake",`.

- [ ] **Step 6: Rodar os testes e a suíte**

Run: `npx vitest run tests/access && npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/access src/app/api/dev/fake-access tests/access .env.example vitest.config.ts
git commit -m "feat: add the access provider contract and a simulated reader"
```

---

### Task 3: Leitores com token e permissões do dono

**Files:**
- Create: `src/domain/access.ts`
- Modify: `src/auth/permissions.ts`
- Create: `tests/domain/access-sources.test.ts`, `tests/auth/access-permissions.test.ts`

**Interfaces:**
- Consumes: Tarefa 1 (tabelas e helpers).
- Produces (`src/domain/access.ts`): `hashAccessToken(token: string): string` (SHA-256 hex), `createAccessSource(tx, orgId, raw: { marketId: string; name: string }): Promise<{ id: string; token: string }>` (`invalid_input` para nome fora de 2 a 60 caracteres, `not_found` para mercado inexistente ou de outra organização), `revokeAccessSource(tx, sourceId): Promise<void>` (idempotente, `not_found` para id malformado ou inexistente).
- Produces (`permissions.ts`): ações `"access:read"` e `"access:write"` só no papel `owner`.

- [ ] **Step 1: Escrever os testes**

Criar `tests/domain/access-sources.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { adminSql } from "@/db/client";
import { withOrg } from "@/db/tenant";
import { createAccessSource, hashAccessToken, revokeAccessSource } from "@/domain/access";
import { codeOf, makeOrg, resetDb, seedStore } from "../helpers";

beforeEach(resetDb);

const UNKNOWN = "00000000-0000-4000-8000-000000000000";

describe("access sources", () => {
  it("creates a reader, returns the token once and stores only its hash", async () => {
    const orgId = await makeOrg("A");
    const { marketId } = await seedStore(orgId);
    const { id, token } = await withOrg(orgId, (tx) => createAccessSource(tx, orgId, { marketId, name: "Porta A" }));
    expect(token.length).toBeGreaterThanOrEqual(40);
    const [row] = await adminSql`select token_hash, market_id, org_id, revoked_at, name from access_sources where id = ${id}`;
    expect(row.token_hash).toBe(hashAccessToken(token));
    expect(row.token_hash).not.toBe(token);
    expect([row.market_id, row.org_id, row.revoked_at, row.name]).toEqual([marketId, orgId, null, "Porta A"]);
  });

  it("gives every reader a different token", async () => {
    const orgId = await makeOrg("A");
    const { marketId } = await seedStore(orgId);
    const a = await withOrg(orgId, (tx) => createAccessSource(tx, orgId, { marketId, name: "Porta A" }));
    const b = await withOrg(orgId, (tx) => createAccessSource(tx, orgId, { marketId, name: "Porta B" }));
    expect(a.token).not.toBe(b.token);
  });

  it("refuses bad names and unknown or foreign markets", async () => {
    const a = await makeOrg("A");
    const b = await makeOrg("B");
    const mine = await seedStore(a);
    const theirs = await seedStore(b);
    const run = (raw: object) => codeOf(withOrg(a, (tx) => createAccessSource(tx, a, raw)));
    expect(await run({ marketId: mine.marketId, name: "x" })).toBe("invalid_input");
    expect(await run({ marketId: mine.marketId, name: "y".repeat(61) })).toBe("invalid_input");
    expect(await run({ marketId: "nope", name: "Porta A" })).toBe("invalid_input");
    expect(await run({ marketId: UNKNOWN, name: "Porta A" })).toBe("not_found");
    expect(await run({ marketId: theirs.marketId, name: "Porta A" })).toBe("not_found");
    expect(await adminSql`select id from access_sources`).toHaveLength(0);
  });

  it("revokes a reader, keeps the first revocation time and knows unknown ids", async () => {
    const orgId = await makeOrg("A");
    const other = await makeOrg("B");
    const { marketId } = await seedStore(orgId);
    const { id } = await withOrg(orgId, (tx) => createAccessSource(tx, orgId, { marketId, name: "Porta A" }));
    await withOrg(orgId, (tx) => revokeAccessSource(tx, id));
    const [first] = await adminSql`select revoked_at from access_sources where id = ${id}`;
    expect(first.revoked_at).not.toBeNull();
    await withOrg(orgId, (tx) => revokeAccessSource(tx, id));
    const [second] = await adminSql`select revoked_at from access_sources where id = ${id}`;
    expect(second.revoked_at).toEqual(first.revoked_at);
    expect(await codeOf(withOrg(orgId, (tx) => revokeAccessSource(tx, UNKNOWN)))).toBe("not_found");
    expect(await codeOf(withOrg(orgId, (tx) => revokeAccessSource(tx, "nope")))).toBe("not_found");
    expect(await codeOf(withOrg(other, (tx) => revokeAccessSource(tx, id)))).toBe("not_found");
  });
});
```

Criar `tests/auth/access-permissions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { can } from "@/auth/permissions";

describe("access permissions", () => {
  it("only the owner can read and manage the access log", () => {
    expect(can("owner", "access:read")).toBe(true);
    expect(can("owner", "access:write")).toBe(true);
    for (const role of ["manager", "restocker"] as const) {
      expect(can(role, "access:read")).toBe(false);
      expect(can(role, "access:write")).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/domain/access-sources.test.ts tests/auth/access-permissions.test.ts`
Expected: FAIL.

- [ ] **Step 3: Permissões (`src/auth/permissions.ts`)**

Na lista do `owner` da `MATRIX`, acrescentar `"access:read", "access:write",` (por exemplo depois de `"sale:read"`). `manager` e `restocker` não mudam.

- [ ] **Step 4: Escrever `src/domain/access.ts`**

```ts
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { Tx } from "@/db/tenant";
import { AppError, isForeignKeyViolation, isInsufficientPrivilege } from "@/lib/errors";
import { parse } from "@/lib/validate";

export const hashAccessToken = (token: string): string => createHash("sha256").update(token).digest("hex");

const SourceInput = z.object({ marketId: z.string().uuid(), name: z.string().trim().min(2).max(60) });

/** The plain token is returned once and never stored: only its SHA-256 is. */
export async function createAccessSource(
  tx: Tx,
  orgId: string,
  raw: unknown,
): Promise<{ id: string; token: string }> {
  const i = parse(SourceInput, raw);
  const token = randomBytes(32).toString("base64url");
  try {
    const [row] = await tx`
      insert into access_sources (org_id, market_id, name, token_hash)
      values (${orgId}, ${i.marketId}, ${i.name}, ${hashAccessToken(token)})
      returning id`;
    return { id: row.id as string, token };
  } catch (e) {
    if (isForeignKeyViolation(e) || isInsufficientPrivilege(e)) throw new AppError("not_found");
    throw e;
  }
}

const uuid = z.string().uuid();

export async function revokeAccessSource(tx: Tx, sourceId: string): Promise<void> {
  if (!uuid.safeParse(sourceId).success) throw new AppError("not_found");
  const rows = await tx`
    update access_sources set revoked_at = coalesce(revoked_at, now()) where id = ${sourceId} returning id`;
  if (rows.length === 0) throw new AppError("not_found");
}
```

- [ ] **Step 5: Rodar os testes e a suíte**

Run: `npx vitest run tests/domain/access-sources.test.ts tests/auth && npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/domain/access.ts src/auth/permissions.ts tests/domain/access-sources.test.ts tests/auth/access-permissions.test.ts
git commit -m "feat: register access readers with a token and restrict them to the owner"
```

---

### Task 4: Ingestão de eventos (`POST /api/access/events`)

**Files:**
- Create: `src/access/auth.ts`, `src/access/http.ts`, `src/app/api/access/events/route.ts`
- Modify: `src/domain/access.ts`
- Create: `tests/access/ingestion.test.ts`

**Interfaces:**
- Consumes: Tarefas 1 a 3 (`hashAccessToken`, helpers).
- Produces: `requireSource(req): Promise<SourceAuth>` com `SourceAuth = { sourceId: string; orgId: string; marketId: string }` (erros `unauthorized` e `source_revoked`); `recordAccessEvent(tx, auth: SourceAuth, raw: unknown, now: Date): Promise<{ id: string | null; duplicate: boolean }>`; constantes `MAX_FUTURE_MS = 5 * 60_000` e `MAX_PAST_MS = 7 * 86_400_000`; `eventHandler(req: Request, now?: Date): Promise<Response>` (201 `{ id }` para evento novo, 200 `{ duplicate: true }` para repetido, 400/401 com `{ error, message }`).

- [ ] **Step 1: Escrever os testes**

Criar `tests/access/ingestion.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { eventHandler } from "@/access/http";
import { adminSql } from "@/db/client";
import { makeOrg, resetDb, seedAccessSource, seedPerson, seedStore } from "../helpers";

beforeEach(resetDb);

const NOW = new Date("2026-10-05T15:00:00Z");
const iso = (ms: number) => new Date(NOW.getTime() + ms).toISOString();
const MIN = 60_000;
const DAY = 86_400_000;

async function setup() {
  const orgId = await makeOrg("A");
  const { marketId } = await seedStore(orgId);
  const source = await seedAccessSource(orgId, marketId);
  return { orgId, marketId, source };
}

const send = (token: string | undefined, body?: unknown, raw?: string) =>
  eventHandler(
    new Request("http://m77.test/api/access/events", {
      method: "POST",
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" },
      body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
    }),
    NOW,
  );
const json = async (r: Response) => (await r.json()) as Record<string, any>;
const events = () => adminSql`select * from access_events order by received_at, id`;

describe("event ingestion", () => {
  it("stores an entry in the market and organization of the reader", async () => {
    const { orgId, marketId, source } = await setup();
    const res = await send(source.token, { occurredAt: iso(-MIN), eventId: "e1", personId: "u1", kind: "entry" });
    const body = await json(res);
    expect([res.status, typeof body.id]).toEqual([201, "string"]);
    const [e] = await events();
    expect([e.org_id, e.market_id, e.source_id, e.person_external_id, e.event_id, e.kind]).toEqual([
      orgId,
      marketId,
      source.id,
      "u1",
      "e1",
      "entry",
    ]);
    expect(e.occurred_at).toEqual(new Date(NOW.getTime() - MIN));
    const [s] = await adminSql`select last_event_at from access_sources where id = ${source.id}`;
    expect(s.last_event_at).toEqual(NOW);
  });

  it("works with only the time, and ignores a body that tries to choose the market or add data", async () => {
    const { orgId, marketId, source } = await setup();
    const other = await seedStore(orgId);
    const res = await send(source.token, {
      occurredAt: iso(0),
      marketId: other.marketId,
      orgId: "00000000-0000-4000-8000-000000000000",
      photo: "BASE64-FACE-IMAGE",
      template: "SECRET",
    });
    expect(res.status).toBe(201);
    const [e] = await events();
    expect([e.market_id, e.person_external_id, e.event_id]).toEqual([marketId, null, null]);
    const [all] = await adminSql`select to_jsonb(e)::text as t from access_events e`;
    expect(all.t).not.toContain("BASE64-FACE-IMAGE");
    expect(all.t).not.toContain("SECRET");
  });

  it("answers 200 duplicate for a repeated event id and keeps one row", async () => {
    const { source } = await setup();
    await send(source.token, { occurredAt: iso(0), eventId: "e1" });
    const again = await send(source.token, { occurredAt: iso(0), eventId: "e1" });
    expect([again.status, await json(again)]).toEqual([200, { duplicate: true }]);
    expect(await events()).toHaveLength(1);
  });

  it("accepts the same event id from another reader and repeats without an event id", async () => {
    const { orgId, marketId, source } = await setup();
    const other = await seedAccessSource(orgId, marketId);
    await send(source.token, { occurredAt: iso(0), eventId: "e1" });
    await send(other.token, { occurredAt: iso(0), eventId: "e1" });
    await send(source.token, { occurredAt: iso(0) });
    await send(source.token, { occurredAt: iso(0) });
    expect(await events()).toHaveLength(4);
  });

  it("enforces the time window: 5 minutes ahead and 7 days back", async () => {
    const { source } = await setup();
    expect((await send(source.token, { occurredAt: iso(4 * MIN) })).status).toBe(201);
    expect((await send(source.token, { occurredAt: iso(6 * MIN) })).status).toBe(400);
    expect((await send(source.token, { occurredAt: iso(-6 * DAY) })).status).toBe(201);
    expect((await send(source.token, { occurredAt: iso(-8 * DAY) })).status).toBe(400);
    expect(await events()).toHaveLength(2);
  });

  it("answers 400 to bad fields and broken JSON without storing anything", async () => {
    const { source } = await setup();
    const bad = async (body: unknown, raw?: string) => {
      const r = await send(source.token, body, raw);
      expect([r.status, (await json(r)).error]).toEqual([400, "invalid_input"]);
    };
    await bad({});
    await bad({ occurredAt: "ontem" });
    await bad({ occurredAt: "2026-10-05" });
    await bad({ occurredAt: iso(0), kind: "exit" });
    await bad({ occurredAt: iso(0), personId: "" });
    await bad({ occurredAt: iso(0), personId: "p".repeat(65) });
    await bad({ occurredAt: iso(0), eventId: 7 });
    await bad(undefined, "{");
    await bad(undefined, "null");
    expect(await events()).toHaveLength(0);
  });

  it("answers 401 for a missing, wrong or revoked token and stores nothing", async () => {
    const { orgId, marketId, source } = await setup();
    const revoked = await seedAccessSource(orgId, marketId, { revoked: true });
    const noToken = await send(undefined, { occurredAt: iso(0) });
    expect([noToken.status, (await json(noToken)).error]).toEqual([401, "unauthorized"]);
    expect((await send("wrong", { occurredAt: iso(0) })).status).toBe(401);
    const gone = await send(revoked.token, { occurredAt: iso(0) });
    expect([gone.status, (await json(gone)).error]).toEqual([401, "source_revoked"]);
    expect(await events()).toHaveLength(0);
  });

  it("stores no identifier for a person who asked to be forgotten", async () => {
    const { orgId, source } = await setup();
    await seedPerson(orgId, source.id, "u1", "Ana", { forgotten: true });
    await send(source.token, { occurredAt: iso(0), personId: "u1" });
    await send(source.token, { occurredAt: iso(0), personId: "u2" });
    expect((await events()).map((e) => e.person_external_id).sort()).toEqual([null, "u2"].sort());
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/access/ingestion.test.ts`
Expected: FAIL.

- [ ] **Step 3: Autenticação do leitor (`src/access/auth.ts`)**

```ts
import { adminSql } from "@/db/client";
import { hashAccessToken } from "@/domain/access";
import { AppError } from "@/lib/errors";

export type SourceAuth = { sourceId: string; orgId: string; marketId: string };

/**
 * Resolves "Authorization: Bearer <token>" to a reader. This runs before any tenant is known,
 * so it uses adminSql, like the terminal lookup; everything after it goes through withOrg().
 */
export async function requireSource(req: Request): Promise<SourceAuth> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) throw new AppError("unauthorized");
  const [row] = await adminSql`
    select id, org_id, market_id, revoked_at from access_sources where token_hash = ${hashAccessToken(token)}`;
  if (!row) throw new AppError("unauthorized");
  if (row.revoked_at) throw new AppError("source_revoked");
  return { sourceId: row.id as string, orgId: row.org_id as string, marketId: row.market_id as string };
}
```

- [ ] **Step 4: Registrar o evento (`src/domain/access.ts`)**

Acrescentar `import type { SourceAuth } from "@/access/auth";` aos imports e, no fim do arquivo:

```ts
export const MAX_FUTURE_MS = 5 * 60_000;
export const MAX_PAST_MS = 7 * 86_400_000;

// zod drops unknown keys: nothing but these four fields is ever stored.
const EventInput = z.object({
  occurredAt: z.string().datetime({ offset: true }),
  eventId: z.string().min(1).max(64).optional(),
  personId: z.string().min(1).max(64).optional(),
  kind: z.literal("entry").optional(),
});

/** Stores one entry. A repeated event id of the same reader is a duplicate and writes nothing. */
export async function recordAccessEvent(
  tx: Tx,
  auth: SourceAuth,
  raw: unknown,
  now: Date,
): Promise<{ id: string | null; duplicate: boolean }> {
  const e = parse(EventInput, raw);
  const at = new Date(e.occurredAt);
  if (at.getTime() > now.getTime() + MAX_FUTURE_MS || at.getTime() < now.getTime() - MAX_PAST_MS) {
    throw new AppError("invalid_input", "occurredAt out of range");
  }
  let personId = e.personId ?? null;
  if (personId) {
    const [forgotten] = await tx`
      select 1 from access_people
      where source_id = ${auth.sourceId} and external_id = ${personId} and forgotten_at is not null`;
    if (forgotten) personId = null; // she asked to be forgotten: no identifier is kept
  }
  const [row] = await tx`
    insert into access_events (org_id, market_id, source_id, occurred_at, person_external_id, event_id)
    values (${auth.orgId}, ${auth.marketId}, ${auth.sourceId}, ${at}, ${personId}, ${e.eventId ?? null})
    on conflict (source_id, event_id) where event_id is not null do nothing
    returning id`;
  if (!row) return { id: null, duplicate: true };
  await tx`update access_sources set last_event_at = ${now} where id = ${auth.sourceId}`;
  return { id: row.id as string, duplicate: false };
}
```

- [ ] **Step 5: Handler, respostas e rota**

Criar `src/access/http.ts`:

```ts
import { withOrg } from "@/db/tenant";
import { recordAccessEvent } from "@/domain/access";
import { AppError } from "@/lib/errors";
import { requireSource } from "./auth";

const STATUS: Record<string, number> = { invalid_input: 400, unauthorized: 401, source_revoked: 401 };
const MESSAGES: Record<string, string> = {
  invalid_input: "Dados inválidos.",
  unauthorized: "Leitor não autorizado.",
  source_revoked: "Leitor desativado.",
};

function errorResponse(e: unknown): Response {
  if (e instanceof AppError) {
    return Response.json(
      { error: e.code, message: MESSAGES[e.code] ?? "Erro inesperado." },
      { status: STATUS[e.code] ?? 400 },
    );
  }
  console.error(e);
  return Response.json({ error: "internal", message: "Erro inesperado." }, { status: 500 });
}

async function bodyOf(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new AppError("invalid_input");
  }
}

/** POST /api/access/events: 201 for a new entry, 200 { duplicate: true } for a repeated event id. */
export const eventHandler = async (req: Request, now: Date = new Date()): Promise<Response> => {
  try {
    const auth = await requireSource(req);
    const raw = await bodyOf(req);
    const r = await withOrg(auth.orgId, (tx) => recordAccessEvent(tx, auth, raw, now));
    return r.duplicate ? Response.json({ duplicate: true }) : Response.json({ id: r.id }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
};
```

Criar `src/app/api/access/events/route.ts`:

```ts
import { eventHandler } from "@/access/http";

export async function POST(req: Request) {
  return eventHandler(req);
}
```

- [ ] **Step 6: Rodar os testes e a suíte**

Run: `npx vitest run tests/access/ingestion.test.ts && npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/access/auth.ts src/access/http.ts src/app/api/access src/domain/access.ts tests/access/ingestion.test.ts
git commit -m "feat: receive access events from a reader with a token"
```

---

### Task 5: Sincronização de pessoas

**Files:**
- Modify: `src/domain/access.ts`
- Create: `tests/access/sync.test.ts`

**Interfaces:**
- Consumes: Tarefas 1 a 3 (`seedAccessSource`, `seedPerson`, `revokeAccessSource`), Tarefa 2 (`AccessProvider`, `getAccessProvider`, `fakeAccessProvider`, `setFakePeople`, `setFakeAccessMode`, `resetFakeAccess`).
- Produces (`src/domain/access.ts`): `SYNC_INTERVAL_MS = 10 * 60_000`, `syncAccessSources(now?: Date, limit?: number, provider?: AccessProvider): Promise<number>` (devolve quantos leitores tiveram uma tentativa de sincronização, com sucesso ou falha).

- [ ] **Step 1: Escrever os testes**

Criar `tests/access/sync.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetFakeAccess, setFakeAccessMode, setFakePeople } from "@/access/fake-access";
import type { AccessProvider } from "@/access/provider";
import { adminSql } from "@/db/client";
import { withOrg } from "@/db/tenant";
import { revokeAccessSource, syncAccessSources } from "@/domain/access";
import { makeOrg, resetDb, seedAccessSource, seedPerson, seedStore } from "../helpers";

beforeEach(async () => {
  await resetDb();
  resetFakeAccess();
});

const NOW = new Date("2026-10-05T15:00:00Z");
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);

async function setup() {
  const orgId = await makeOrg("A");
  const { marketId } = await seedStore(orgId);
  const source = await seedAccessSource(orgId, marketId);
  return { orgId, marketId, source };
}
const people = (sourceId: string) =>
  adminSql`select external_id, name, active, forgotten_at from access_people where source_id = ${sourceId} order by external_id`;
const src = async (id: string) =>
  (await adminSql`select last_sync_at, last_sync_error from access_sources where id = ${id}`)[0];

describe("people sync", () => {
  it("stores the people the reader reports and stamps the source", async () => {
    const { source } = await setup();
    setFakePeople(source.id, [
      { externalId: "u1", name: "Ana" },
      { externalId: "u2", name: "Bia" },
    ]);
    expect(await syncAccessSources(NOW)).toBe(1);
    expect((await people(source.id)).map((p) => [p.external_id, p.name, p.active])).toEqual([
      ["u1", "Ana", true],
      ["u2", "Bia", true],
    ]);
    expect(await src(source.id)).toEqual({ last_sync_at: NOW, last_sync_error: null });
  });

  it("syncs a reader at most once every 10 minutes", async () => {
    const { source } = await setup();
    await syncAccessSources(NOW);
    expect(await syncAccessSources(minutes(9))).toBe(0);
    expect(await syncAccessSources(minutes(10))).toBe(1);
    expect((await src(source.id)).last_sync_at).toEqual(minutes(10));
  });

  it("updates names, deactivates people who left and reactivates them when they return", async () => {
    const { source } = await setup();
    setFakePeople(source.id, [
      { externalId: "u1", name: "Ana" },
      { externalId: "u2", name: "Bia" },
    ]);
    await syncAccessSources(NOW);
    setFakePeople(source.id, [{ externalId: "u1", name: "Ana Maria" }]);
    await syncAccessSources(minutes(10));
    expect((await people(source.id)).map((p) => [p.external_id, p.name, p.active])).toEqual([
      ["u1", "Ana Maria", true],
      ["u2", "Bia", false],
    ]);
    setFakePeople(source.id, [
      { externalId: "u1", name: "Ana Maria" },
      { externalId: "u2", name: "Bia" },
    ]);
    await syncAccessSources(minutes(20));
    expect((await people(source.id)).map((p) => p.active)).toEqual([true, true]);
  });

  it("deactivates everyone when the reader reports an empty list", async () => {
    const { source } = await setup();
    setFakePeople(source.id, [{ externalId: "u1", name: "Ana" }]);
    await syncAccessSources(NOW);
    setFakePeople(source.id, []);
    await syncAccessSources(minutes(10));
    expect((await people(source.id)).map((p) => p.active)).toEqual([false]);
    expect((await src(source.id)).last_sync_error).toBeNull();
  });

  it("skips entries without an id or a name and keeps the first of a repeated id", async () => {
    const { source } = await setup();
    setFakePeople(source.id, [
      { externalId: "u1", name: "Ana" },
      { externalId: "u1", name: "Outra" },
      { externalId: "", name: "Sem id" },
      { externalId: "u3", name: "   " },
      { externalId: "u4", name: "Dan" },
    ]);
    await syncAccessSources(NOW);
    expect((await people(source.id)).map((p) => [p.external_id, p.name])).toEqual([
      ["u1", "Ana"],
      ["u4", "Dan"],
    ]);
  });

  it("keeps the old list and records the error when the reader is down", async () => {
    const { source } = await setup();
    setFakePeople(source.id, [{ externalId: "u1", name: "Ana" }]);
    await syncAccessSources(NOW);
    setFakeAccessMode("down");
    expect(await syncAccessSources(minutes(10))).toBe(1);
    expect((await people(source.id)).map((p) => [p.name, p.active])).toEqual([["Ana", true]]);
    const s = await src(source.id);
    expect(s.last_sync_at).toEqual(minutes(10));
    expect(s.last_sync_error).toMatch(/unavailable/);
    setFakeAccessMode("ok");
    await syncAccessSources(minutes(20));
    expect((await src(source.id)).last_sync_error).toBeNull();
  });

  it("never recreates, renames or reactivates a forgotten person", async () => {
    const { orgId, source } = await setup();
    await seedPerson(orgId, source.id, "u1", "Ana", { forgotten: true, active: false });
    setFakePeople(source.id, [
      { externalId: "u1", name: "Ana de novo" },
      { externalId: "u2", name: "Bia" },
    ]);
    await syncAccessSources(NOW);
    const rows = await people(source.id);
    expect(rows.map((p) => [p.external_id, p.name, p.active])).toEqual([
      ["u1", null, false],
      ["u2", "Bia", true],
    ]);
    expect(rows[0].forgotten_at).not.toBeNull();
  });

  it("skips a revoked reader", async () => {
    const { orgId, source } = await setup();
    await withOrg(orgId, (tx) => revokeAccessSource(tx, source.id));
    expect(await syncAccessSources(NOW)).toBe(0);
    expect((await src(source.id)).last_sync_at).toBeNull();
  });

  it("counts a SQL failure in the middle as a failed sync and keeps the transaction usable", async () => {
    const { source } = await setup();
    setFakePeople(source.id, [{ externalId: "u1", name: "Ana" }]);
    await syncAccessSources(NOW);
    setFakePeople(source.id, [
      { externalId: "u2", name: "Bia" },
      { externalId: "bad\u0000id", name: "Nul" }, // Postgres refuses a NUL byte in text
    ]);
    expect(await syncAccessSources(minutes(10))).toBe(1);
    expect((await people(source.id)).map((p) => [p.external_id, p.active])).toEqual([["u1", true]]);
    expect((await src(source.id)).last_sync_error).not.toBeNull();
  });

  it("keeps going when one reader blows up", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { orgId, marketId, source: a } = await setup();
    const b = await seedAccessSource(orgId, marketId, { name: "Leitor 2" });
    const provider: AccessProvider = {
      name: "mixed",
      listPeople: async (s) => {
        if (s.id === a.id) throw new Error("boom");
        return [{ externalId: "u9", name: "Zé" }];
      },
    };
    expect(await syncAccessSources(NOW, 50, provider)).toBe(2);
    expect((await src(a.id)).last_sync_error).toBe("boom");
    expect((await people(b.id)).map((p) => p.external_id)).toEqual(["u9"]);
  });

  it("syncs a reader once when two processors run together", async () => {
    const { source } = await setup();
    setFakePeople(source.id, [{ externalId: "u1", name: "Ana" }]);
    const [x, y] = await Promise.all([syncAccessSources(NOW), syncAccessSources(NOW)]);
    expect(x + y).toBe(1);
    expect(await people(source.id)).toHaveLength(1);
  });

  it("syncs a long list in chunks", async () => {
    const { source } = await setup();
    setFakePeople(
      source.id,
      Array.from({ length: 1200 }, (_, i) => ({ externalId: `u${i}`, name: `Pessoa ${i}` })),
    );
    await syncAccessSources(NOW);
    expect(await people(source.id)).toHaveLength(1200);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/access/sync.test.ts`
Expected: FAIL (`syncAccessSources` não existe).

- [ ] **Step 3: Implementar em `src/domain/access.ts`**

Acrescentar aos imports: `import { adminSql } from "@/db/client";`, `import { withOrg } from "@/db/tenant";`, `import { getAccessProvider } from "@/access/registry";`, `import type { AccessProvider } from "@/access/provider";` e `import { withTimeout } from "@/payments/provider";` (juntando com os imports que já existem). No fim do arquivo:

```ts
export const SYNC_INTERVAL_MS = 10 * 60_000;
const CHUNK = 500;

const Person = z.object({ externalId: z.string().trim().min(1).max(64), name: z.string().trim().min(1).max(120) });

/** Valid entries only; the first of a repeated id wins. */
function cleanPeople(listed: unknown[]): { externalId: string; name: string }[] {
  const seen = new Map<string, { externalId: string; name: string }>();
  for (const p of listed) {
    const r = Person.safeParse(p);
    if (r.success && !seen.has(r.data.externalId)) seen.set(r.data.externalId, r.data);
  }
  return [...seen.values()];
}

/**
 * One sync of one reader, under a row lock that other processors skip.
 * ponytail: the provider call runs inside the transaction, like the other providers; the 5 s timeout bounds the lock.
 */
async function syncOne(tx: Tx, id: string, provider: AccessProvider, now: Date): Promise<boolean> {
  const due = new Date(now.getTime() - SYNC_INTERVAL_MS);
  const [s] = await tx`
    select id, org_id, market_id, name from access_sources
    where id = ${id} and revoked_at is null and (last_sync_at is null or last_sync_at <= ${due})
    for update skip locked`;
  if (!s) return false;
  try {
    const listed = await withTimeout(
      provider.listPeople({ id, marketId: s.market_id as string, name: s.name as string }),
    );
    const people = cleanPeople(listed as unknown[]);
    // A savepoint: a SQL error here must not abort the transaction that records the failure below.
    await tx.savepoint(async (sp) => {
      for (let i = 0; i < people.length; i += CHUNK) {
        const rows = people.slice(i, i + CHUNK).map((p) => ({ external_id: p.externalId, name: p.name }));
        await sp`
          insert into access_people (org_id, source_id, external_id, name, active, synced_at)
          select ${s.org_id as string}, ${id}, x.external_id, x.name, true, ${now}
          from jsonb_to_recordset(${sp.json(rows)}) as x(external_id text, name text)
          on conflict (source_id, external_id) do update set
            name = case when access_people.forgotten_at is not null then null else excluded.name end,
            active = (access_people.forgotten_at is null),
            synced_at = excluded.synced_at`;
      }
      const ids = people.map((p) => p.externalId);
      if (ids.length === 0) {
        await sp`update access_people set active = false where source_id = ${id} and active`;
      } else {
        await sp`
          update access_people set active = false
          where source_id = ${id} and active and external_id not in ${sp(ids)}`;
      }
      await sp`update access_sources set last_sync_at = ${now}, last_sync_error = null where id = ${id}`;
    });
  } catch (e) {
    const why = (e instanceof Error ? e.message : String(e)).slice(0, 200);
    await tx`update access_sources set last_sync_at = ${now}, last_sync_error = ${why} where id = ${id}`;
  }
  return true;
}

/** Syncs every reader that is due. Meant for POST /api/internal/reconcile, once a minute. */
export async function syncAccessSources(
  now: Date = new Date(),
  limit = 50,
  provider?: AccessProvider,
): Promise<number> {
  const due = new Date(now.getTime() - SYNC_INTERVAL_MS);
  const rows = await adminSql`
    select id, org_id from access_sources
    where revoked_at is null and (last_sync_at is null or last_sync_at <= ${due})
    order by last_sync_at nulls first limit ${limit}`;
  if (rows.length === 0) return 0;
  const p = provider ?? getAccessProvider();
  let done = 0;
  for (const r of rows) {
    try {
      if (await withOrg(r.org_id as string, (tx) => syncOne(tx, r.id as string, p, now))) done++;
    } catch (e) {
      console.error("access sync failed for source", r.id, e); // one bad reader must not stop the others
    }
  }
  return done;
}
```

- [ ] **Step 4: Rodar os testes e a suíte**

Run: `npx vitest run tests/access && npm test && npm run typecheck`
Expected: PASS. Se a consulta `not in ${sp(ids)}` ou o `jsonb_to_recordset` pedirem ajuste de tipo no postgres.js, corrija o mínimo e registre no relatório.

- [ ] **Step 5: Commit**

```bash
git add src/domain/access.ts tests/access/sync.test.ts
git commit -m "feat: sync the people of each access reader"
```

---

### Task 6: Retenção, esquecer pessoa e rota de reconciliação

**Files:**
- Modify: `src/domain/access.ts`
- Modify: `src/app/api/internal/reconcile/route.ts`
- Modify: `tests/pdv/routes.test.ts`, `tests/pdv/reconcile-fiscal.test.ts` (uma asserção em cada)
- Create: `tests/domain/access-retention.test.ts`, `tests/pdv/reconcile-access.test.ts`

**Interfaces:**
- Consumes: Tarefas 1 e 5.
- Produces: `ACCESS_RETENTION_DAYS = 90`, `purgeAccessEvents(now?: Date, limit?: number): Promise<number>`, `forgetAccessPerson(tx, personId: string, now: Date): Promise<void>`; a rota `POST /api/internal/reconcile` responde `{ visited, fiscal, access: { synced, purged } }`, com cada fila isolada das outras.

- [ ] **Step 1: Escrever os testes**

Criar `tests/domain/access-retention.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { adminSql } from "@/db/client";
import { withOrg } from "@/db/tenant";
import { ACCESS_RETENTION_DAYS, forgetAccessPerson, purgeAccessEvents } from "@/domain/access";
import { codeOf, makeOrg, resetDb, seedAccessEvent, seedAccessSource, seedPerson, seedStore } from "../helpers";

beforeEach(resetDb);

const NOW = new Date("2026-10-05T15:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const UNKNOWN = "00000000-0000-4000-8000-000000000000";

async function setup() {
  const orgId = await makeOrg("A");
  const { marketId } = await seedStore(orgId);
  const source = await seedAccessSource(orgId, marketId);
  return { orgId, marketId, source };
}
const count = async () => (await adminSql`select count(*)::int as n from access_events`)[0].n as number;

describe("retention", () => {
  it("keeps 90 days and deletes what is older, across tenants", async () => {
    expect(ACCESS_RETENTION_DAYS).toBe(90);
    const a = await setup();
    const b = await setup();
    await seedAccessEvent(a.orgId, a.marketId, a.source.id, { at: daysAgo(89) });
    await seedAccessEvent(a.orgId, a.marketId, a.source.id, { at: daysAgo(91) });
    await seedAccessEvent(b.orgId, b.marketId, b.source.id, { at: daysAgo(120) });
    expect(await purgeAccessEvents(NOW)).toBe(2);
    expect(await count()).toBe(1);
  });

  it("measures the cutoff from the given time, not from the clock", async () => {
    const { orgId, marketId, source } = await setup();
    await seedAccessEvent(orgId, marketId, source.id, { at: daysAgo(89) });
    expect(await purgeAccessEvents(NOW)).toBe(0);
    expect(await purgeAccessEvents(new Date(NOW.getTime() + 2 * 86_400_000))).toBe(1);
  });

  it("deletes in batches, oldest first", async () => {
    const { orgId, marketId, source } = await setup();
    for (const d of [100, 95, 92]) await seedAccessEvent(orgId, marketId, source.id, { at: daysAgo(d) });
    expect(await purgeAccessEvents(NOW, 2)).toBe(2);
    const [left] = await adminSql`select occurred_at from access_events`;
    expect(left.occurred_at).toEqual(daysAgo(92));
    expect(await purgeAccessEvents(NOW, 2)).toBe(1);
    expect(await purgeAccessEvents(NOW, 2)).toBe(0);
  });
});

describe("forgetting a person", () => {
  it("clears the name, anonymizes the old events and marks her forgotten", async () => {
    const { orgId, marketId, source } = await setup();
    const id = await seedPerson(orgId, source.id, "u1", "Ana");
    await seedPerson(orgId, source.id, "u2", "Bia");
    await seedAccessEvent(orgId, marketId, source.id, { at: NOW, personId: "u1" });
    await seedAccessEvent(orgId, marketId, source.id, { at: NOW, personId: "u1" });
    await seedAccessEvent(orgId, marketId, source.id, { at: NOW, personId: "u2" });
    await withOrg(orgId, (tx) => forgetAccessPerson(tx, id, NOW));
    const [p] = await adminSql`select name, active, forgotten_at from access_people where id = ${id}`;
    expect([p.name, p.active, p.forgotten_at]).toEqual([null, false, NOW]);
    const ev = await adminSql`select person_external_id from access_events order by id`;
    expect(ev.map((e) => e.person_external_id).sort()).toEqual([null, null, "u2"].sort());
    const [bia] = await adminSql`select name, active from access_people where external_id = 'u2'`;
    expect([bia.name, bia.active]).toEqual(["Bia", true]);
  });

  it("is idempotent and keeps the first forgetting time", async () => {
    const { orgId, source } = await setup();
    const id = await seedPerson(orgId, source.id, "u1", "Ana");
    await withOrg(orgId, (tx) => forgetAccessPerson(tx, id, NOW));
    await withOrg(orgId, (tx) => forgetAccessPerson(tx, id, new Date(NOW.getTime() + 60_000)));
    const [p] = await adminSql`select forgotten_at from access_people where id = ${id}`;
    expect(p.forgotten_at).toEqual(NOW);
  });

  it("leaves the same identifier of another reader alone", async () => {
    const { orgId, marketId, source } = await setup();
    const other = await seedAccessSource(orgId, marketId, { name: "Leitor 2" });
    const id = await seedPerson(orgId, source.id, "u1", "Ana");
    await seedPerson(orgId, other.id, "u1", "Ana 2");
    await seedAccessEvent(orgId, marketId, other.id, { at: NOW, personId: "u1" });
    await withOrg(orgId, (tx) => forgetAccessPerson(tx, id, NOW));
    const [e] = await adminSql`select person_external_id from access_events`;
    expect(e.person_external_id).toBe("u1");
  });

  it("does not find unknown, malformed or other-tenant people", async () => {
    const a = await setup();
    const b = await setup();
    const theirs = await seedPerson(b.orgId, b.source.id, "u1", "Ana");
    const run = (id: string) => codeOf(withOrg(a.orgId, (tx) => forgetAccessPerson(tx, id, NOW)));
    expect(await run(UNKNOWN)).toBe("not_found");
    expect(await run("nope")).toBe("not_found");
    expect(await run(theirs)).toBe("not_found");
    const [p] = await adminSql`select name from access_people where id = ${theirs}`;
    expect(p.name).toBe("Ana");
  });
});
```

Criar `tests/pdv/reconcile-access.test.ts`:

```ts
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { POST as reconcileRoute } from "@/app/api/internal/reconcile/route";
import { resetFakeAccess, setFakePeople } from "@/access/fake-access";
import { adminSql } from "@/db/client";
import { makeOrg, resetDb, seedAccessEvent, seedAccessSource, seedStore } from "../helpers";

beforeEach(async () => {
  await resetDb();
  resetFakeAccess();
});
afterEach(() => vi.unstubAllEnvs());

it("the reconcile route also syncs the readers and purges old entries", async () => {
  vi.stubEnv("RECONCILE_SECRET", "s3cret");
  const orgId = await makeOrg("A");
  const { marketId } = await seedStore(orgId);
  const source = await seedAccessSource(orgId, marketId);
  setFakePeople(source.id, [{ externalId: "u1", name: "Ana" }]);
  await seedAccessEvent(orgId, marketId, source.id, { at: new Date(Date.now() - 100 * 86_400_000) });
  await seedAccessEvent(orgId, marketId, source.id, { at: new Date() });
  const res = await reconcileRoute(
    new Request("http://m77.test/api/internal/reconcile", { method: "POST", headers: { "x-reconcile-secret": "s3cret" } }),
  );
  expect([res.status, await res.json()]).toEqual([200, { visited: 0, fiscal: 0, access: { synced: 1, purged: 1 } }]);
  expect((await adminSql`select name from access_people`).map((p) => p.name)).toEqual(["Ana"]);
  expect(await adminSql`select id from access_events`).toHaveLength(1);
});
```

Em `tests/pdv/routes.test.ts`, trocar `expect([ok.status, await ok.json()]).toEqual([200, { visited: 0, fiscal: 0 }]);` por `expect([ok.status, await ok.json()]).toEqual([200, { visited: 0, fiscal: 0, access: { synced: 0, purged: 0 } }]);`. Em `tests/pdv/reconcile-fiscal.test.ts`, trocar `[200, { visited: 0, fiscal: 1 }]` por `[200, { visited: 0, fiscal: 1, access: { synced: 0, purged: 0 } }]`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/domain/access-retention.test.ts tests/pdv`
Expected: FAIL.

- [ ] **Step 3: Implementar em `src/domain/access.ts`**

No fim do arquivo:

```ts
export const ACCESS_RETENTION_DAYS = 90;

/** Deletes entries older than the retention window, oldest first, in batches. Admin role: the app cannot delete. */
export async function purgeAccessEvents(now: Date = new Date(), limit = 5000): Promise<number> {
  const cutoff = new Date(now.getTime() - ACCESS_RETENTION_DAYS * 86_400_000);
  const rows = await adminSql`
    delete from access_events where id in (
      select id from access_events where occurred_at < ${cutoff} order by occurred_at limit ${limit}
    ) returning id`;
  return rows.length;
}

/**
 * The person asked to be forgotten: no name, no identifier on the old entries, and the sync never brings her back.
 * Idempotent: the first forgetting time is kept.
 */
export async function forgetAccessPerson(tx: Tx, personId: string, now: Date): Promise<void> {
  if (!uuid.safeParse(personId).success) throw new AppError("not_found");
  const [p] = await tx`
    update access_people set forgotten_at = coalesce(forgotten_at, ${now}), name = null, active = false
    where id = ${personId} returning source_id, external_id`;
  if (!p) throw new AppError("not_found");
  await tx`
    update access_events set person_external_id = null
    where source_id = ${p.source_id as string} and person_external_id = ${p.external_id as string}`;
}
```

- [ ] **Step 4: Atualizar a rota `src/app/api/internal/reconcile/route.ts`**

Acrescentar `import { purgeAccessEvents, syncAccessSources } from "@/domain/access";` e trocar o trecho que monta a resposta (as chamadas de `attempt`) por:

```ts
  const visited = await attempt("reconcile", () => reconcilePending());
  const fiscal = await attempt("fiscal queue", () => processFiscalQueue());
  const synced = await attempt("access sync", () => syncAccessSources());
  const purged = await attempt("access retention", () => purgeAccessEvents());
  return Response.json({ visited, fiscal, access: { synced, purged } });
```

(A função `attempt` que já existe devolve 0 quando a chamada falha e registra o erro.)

- [ ] **Step 5: Rodar os testes e a suíte**

Run: `npx vitest run tests/domain/access-retention.test.ts tests/pdv && npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/domain/access.ts src/app/api/internal/reconcile/route.ts tests/domain/access-retention.test.ts tests/pdv
git commit -m "feat: purge old access events, forget a person and run the access queues"
```

---

### Task 7: Leituras do painel (leitores, pessoas, acessos, resumos)

**Files:**
- Modify: `src/domain/access.ts`
- Create: `tests/domain/access-reads.test.ts`

**Interfaces:**
- Consumes: Tarefas 1 e 3 e os helpers `seedStore`, `seedSellable`, `paidSale`.
- Produces (`src/domain/access.ts`):
  - `type AccessSourceRow = { id; name; createdAt: Date; revokedAt: Date | null; lastSyncAt: Date | null; lastSyncError: string | null; lastEventAt: Date | null; activePeople: number }` e `listAccessSources(tx, marketId): Promise<AccessSourceRow[]>` (mais novo primeiro)
  - `type AccessPersonRow = { id; sourceName; externalId; name: string | null; active: boolean; forgotten: boolean }` e `listAccessPeople(tx, marketId)` (esquecidas por último, depois por nome)
  - `type AccessEventRow = { id; occurredAt: Date; sourceName; personExternalId: string | null; personName: string | null; status: "known" | "unregistered" | "anonymous" }` e `listRecentAccess(tx, marketId, limit = 100)` (mais recente primeiro)
  - `type DailyAccessRow = { day: string; entries: number; people: number; paidSales: number; salesPerEntry: number | null }` e `dailyAccessSummary(tx, marketId, now: Date, days = 14)` (um item por dia, o mais recente primeiro, no fuso do mercado)
  - `type HourlyAccessRow = { hour: number; entries: number }` e `hourlyAccess(tx, marketId, day: string)` (24 itens; `invalid_input` para dia malformado ou inexistente)

- [ ] **Step 1: Escrever os testes**

Criar `tests/domain/access-reads.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { withOrg } from "@/db/tenant";
import {
  dailyAccessSummary,
  hourlyAccess,
  listAccessPeople,
  listAccessSources,
  listRecentAccess,
} from "@/domain/access";
import { codeOf, makeOrg, paidSale, resetDb, seedAccessEvent, seedAccessSource, seedPerson, seedSellable, seedStore } from "../helpers";

beforeEach(resetDb);

const NOW = new Date("2026-10-05T15:00:00Z"); // 2026-10-05 in Sao Paulo

async function setup(name = "A") {
  const orgId = await makeOrg(name);
  const store = await seedStore(orgId);
  const source = await seedAccessSource(orgId, store.marketId, { name: "Porta A" });
  return { orgId, store, marketId: store.marketId, source };
}

describe("sources and people", () => {
  it("lists readers with the count of active people, newest first", async () => {
    const { orgId, marketId, source } = await setup();
    await seedPerson(orgId, source.id, "u1", "Ana");
    await seedPerson(orgId, source.id, "u2", "Bia", { active: false });
    const newer = await seedAccessSource(orgId, marketId, { name: "Porta B" });
    const rows = await withOrg(orgId, (tx) => listAccessSources(tx, marketId));
    expect(rows.map((r) => [r.id, r.name, r.activePeople])).toEqual([
      [newer.id, "Porta B", 0],
      [source.id, "Porta A", 1],
    ]);
    expect(rows[1]).toMatchObject({ revokedAt: null, lastSyncAt: null, lastSyncError: null, lastEventAt: null });
  });

  it("lists people by name with the forgotten ones last", async () => {
    const { orgId, marketId, source } = await setup();
    await seedPerson(orgId, source.id, "u2", "Bia");
    await seedPerson(orgId, source.id, "u1", "Ana");
    await seedPerson(orgId, source.id, "u3", "Zé", { forgotten: true, active: false });
    const rows = await withOrg(orgId, (tx) => listAccessPeople(tx, marketId));
    expect(rows.map((r) => [r.externalId, r.name, r.sourceName, r.active, r.forgotten])).toEqual([
      ["u1", "Ana", "Porta A", true, false],
      ["u2", "Bia", "Porta A", true, false],
      ["u3", null, "Porta A", false, true],
    ]);
  });

  it("shows nothing of another market or organization", async () => {
    const a = await setup("A");
    const b = await setup("B");
    await seedPerson(a.orgId, a.source.id, "u1", "Ana");
    await seedAccessEvent(a.orgId, a.marketId, a.source.id, { at: NOW, personId: "u1" });
    expect(await withOrg(b.orgId, (tx) => listAccessPeople(tx, a.marketId))).toEqual([]);
    expect(await withOrg(b.orgId, (tx) => listRecentAccess(tx, a.marketId))).toEqual([]);
    expect(await withOrg(b.orgId, (tx) => listAccessSources(tx, a.marketId))).toEqual([]);
    expect(await withOrg(b.orgId, (tx) => dailyAccessSummary(tx, a.marketId, NOW))).toEqual([]);
  });
});

describe("recent access", () => {
  it("resolves names, tells unregistered from anonymous and orders by time, newest first", async () => {
    const { orgId, marketId, source } = await setup();
    await seedPerson(orgId, source.id, "u1", "Ana");
    const at = (m: number) => new Date(NOW.getTime() - m * 60_000);
    await seedAccessEvent(orgId, marketId, source.id, { at: at(3), personId: "u1" });
    await seedAccessEvent(orgId, marketId, source.id, { at: at(2), personId: "u9" });
    await seedAccessEvent(orgId, marketId, source.id, { at: at(1) });
    const rows = await withOrg(orgId, (tx) => listRecentAccess(tx, marketId));
    expect(rows.map((r) => [r.personExternalId, r.personName, r.status, r.sourceName])).toEqual([
      [null, null, "anonymous", "Porta A"],
      ["u9", null, "unregistered", "Porta A"],
      ["u1", "Ana", "known", "Porta A"],
    ]);
  });

  it("respects the limit", async () => {
    const { orgId, marketId, source } = await setup();
    for (let i = 0; i < 5; i++) await seedAccessEvent(orgId, marketId, source.id, { at: new Date(NOW.getTime() - i * 1000) });
    expect(await withOrg(orgId, (tx) => listRecentAccess(tx, marketId, 3))).toHaveLength(3);
  });
});

describe("daily summary", () => {
  it("returns one row per day in the market time zone, with zeros for quiet days", async () => {
    const { orgId, marketId } = await setup();
    const rows = await withOrg(orgId, (tx) => dailyAccessSummary(tx, marketId, NOW));
    expect(rows).toHaveLength(14);
    expect([rows[0].day, rows[13].day]).toEqual(["2026-10-05", "2026-09-22"]);
    expect(rows.every((r) => r.entries === 0 && r.paidSales === 0 && r.salesPerEntry === null)).toBe(true);
  });

  it("puts an entry near midnight on the right local day", async () => {
    const { orgId, marketId, source } = await setup();
    // 02:30Z is 23:30 of the 3rd in Sao Paulo; 03:30Z is 00:30 of the 4th.
    await seedAccessEvent(orgId, marketId, source.id, { at: new Date("2026-10-04T02:30:00Z") });
    await seedAccessEvent(orgId, marketId, source.id, { at: new Date("2026-10-04T03:30:00Z") });
    const rows = await withOrg(orgId, (tx) => dailyAccessSummary(tx, marketId, NOW));
    const byDay = Object.fromEntries(rows.map((r) => [r.day, r.entries]));
    expect([byDay["2026-10-03"], byDay["2026-10-04"]]).toEqual([1, 1]);
  });

  it("counts distinct people and crosses entries with paid sales of the same day", async () => {
    const { orgId, store, marketId, source } = await setup();
    const day = new Date("2026-10-03T15:00:00Z");
    for (const p of ["u1", "u1", "u2", null]) {
      await seedAccessEvent(orgId, marketId, source.id, { at: day, personId: p });
    }
    await seedSellable(orgId, store.marketId, { barcode: "7891000100103", priceCents: 500 });
    await paidSale(orgId, store, "7891000100103", 1, { now: day });
    await paidSale(orgId, store, "7891000100103", 1, { now: day });
    const rows = await withOrg(orgId, (tx) => dailyAccessSummary(tx, marketId, NOW));
    const d = rows.find((r) => r.day === "2026-10-03");
    expect(d).toMatchObject({ entries: 4, people: 2, paidSales: 2, salesPerEntry: 0.5 });
  });
});

describe("hourly access", () => {
  it("returns 24 hours of the chosen local day", async () => {
    const { orgId, marketId, source } = await setup();
    for (const iso of ["2026-10-03T12:10:00Z", "2026-10-03T12:50:00Z", "2026-10-03T17:00:00Z"]) {
      await seedAccessEvent(orgId, marketId, source.id, { at: new Date(iso) }); // 09:xx and 14:00 in Sao Paulo
    }
    await seedAccessEvent(orgId, marketId, source.id, { at: new Date("2026-10-04T12:00:00Z") }); // another day
    const rows = await withOrg(orgId, (tx) => hourlyAccess(tx, marketId, "2026-10-03"));
    expect(rows).toHaveLength(24);
    expect(rows.filter((r) => r.entries > 0)).toEqual([
      { hour: 9, entries: 2 },
      { hour: 14, entries: 1 },
    ]);
  });

  it("refuses a malformed or impossible day", async () => {
    const { orgId, marketId } = await setup();
    const run = (d: string) => codeOf(withOrg(orgId, (tx) => hourlyAccess(tx, marketId, d)));
    expect(await run("hoje")).toBe("invalid_input");
    expect(await run("2026-02-30")).toBe("invalid_input");
    expect(await run("2026-10-3")).toBe("invalid_input");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/domain/access-reads.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar em `src/domain/access.ts`**

Acrescentar `import { isRealDay } from "./lots";` aos imports (função já existente da fase 5A) e, no fim do arquivo:

```ts
export type AccessSourceRow = {
  id: string;
  name: string;
  createdAt: Date;
  revokedAt: Date | null;
  lastSyncAt: Date | null;
  lastSyncError: string | null;
  lastEventAt: Date | null;
  activePeople: number;
};

export async function listAccessSources(tx: Tx, marketId: string): Promise<AccessSourceRow[]> {
  const rows = await tx`
    select s.id, s.name, s.created_at, s.revoked_at, s.last_sync_at, s.last_sync_error, s.last_event_at,
      (select count(*)::int from access_people p where p.source_id = s.id and p.active) as active_people
    from access_sources s where s.market_id = ${marketId} order by s.created_at desc, s.id`;
  return rows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    createdAt: r.created_at as Date,
    revokedAt: (r.revoked_at as Date | null) ?? null,
    lastSyncAt: (r.last_sync_at as Date | null) ?? null,
    lastSyncError: (r.last_sync_error as string | null) ?? null,
    lastEventAt: (r.last_event_at as Date | null) ?? null,
    activePeople: r.active_people as number,
  }));
}

export type AccessPersonRow = {
  id: string;
  sourceName: string;
  externalId: string;
  name: string | null;
  active: boolean;
  forgotten: boolean;
};

export async function listAccessPeople(tx: Tx, marketId: string): Promise<AccessPersonRow[]> {
  const rows = await tx`
    select p.id, s.name as source_name, p.external_id, p.name, p.active, (p.forgotten_at is not null) as forgotten
    from access_people p join access_sources s on s.id = p.source_id
    where s.market_id = ${marketId}
    order by (p.forgotten_at is not null), lower(p.name), p.external_id`;
  return rows.map((r) => ({
    id: r.id as string,
    sourceName: r.source_name as string,
    externalId: r.external_id as string,
    name: (r.name as string | null) ?? null,
    active: r.active as boolean,
    forgotten: r.forgotten as boolean,
  }));
}

export type AccessEventRow = {
  id: string;
  occurredAt: Date;
  sourceName: string;
  personExternalId: string | null;
  personName: string | null;
  status: "known" | "unregistered" | "anonymous";
};

export async function listRecentAccess(tx: Tx, marketId: string, limit = 100): Promise<AccessEventRow[]> {
  const rows = await tx`
    select e.id, e.occurred_at, s.name as source_name, e.person_external_id, p.name as person_name
    from access_events e
    join access_sources s on s.id = e.source_id
    left join access_people p on p.source_id = e.source_id and p.external_id = e.person_external_id
    where e.market_id = ${marketId}
    order by e.occurred_at desc, e.id limit ${limit}`;
  return rows.map((r) => {
    const personExternalId = (r.person_external_id as string | null) ?? null;
    const personName = (r.person_name as string | null) ?? null;
    return {
      id: r.id as string,
      occurredAt: r.occurred_at as Date,
      sourceName: r.source_name as string,
      personExternalId,
      personName,
      status: personExternalId === null ? "anonymous" : personName !== null ? "known" : "unregistered",
    };
  });
}

export type DailyAccessRow = {
  day: string;
  entries: number;
  people: number;
  paidSales: number;
  salesPerEntry: number | null;
};

/**
 * One row per local day (market time zone), newest first, including quiet days.
 * ponytail: "people" counts distinct (reader, person id); the same person on two readers counts twice.
 */
export async function dailyAccessSummary(tx: Tx, marketId: string, now: Date, days = 14): Promise<DailyAccessRow[]> {
  const rows = await tx`
    with m as (select timezone as tz from markets where id = ${marketId}),
    d as (
      select gs::date as day
      from m, generate_series(
        ((${now}::timestamptz at time zone m.tz)::date - ${days - 1}::int),
        (${now}::timestamptz at time zone m.tz)::date,
        interval '1 day') gs
    ),
    e as (
      select (ev.occurred_at at time zone m.tz)::date as day, count(*)::int as entries,
        count(distinct (ev.source_id, ev.person_external_id)) filter (where ev.person_external_id is not null)::int as people
      from access_events ev, m where ev.market_id = ${marketId} group by 1
    ),
    s as (
      select (sa.paid_at at time zone m.tz)::date as day, count(*)::int as paid
      from sales sa, m where sa.market_id = ${marketId} and sa.status = 'paid' group by 1
    )
    select to_char(d.day, 'YYYY-MM-DD') as day, coalesce(e.entries, 0) as entries,
      coalesce(e.people, 0) as people, coalesce(s.paid, 0) as paid_sales
    from d left join e on e.day = d.day left join s on s.day = d.day
    order by d.day desc`;
  return rows.map((r) => {
    const entries = r.entries as number;
    const paidSales = r.paid_sales as number;
    return {
      day: r.day as string,
      entries,
      people: r.people as number,
      paidSales,
      salesPerEntry: entries > 0 ? paidSales / entries : null,
    };
  });
}

export type HourlyAccessRow = { hour: number; entries: number };

/** The 24 local hours of one day (YYYY-MM-DD) in the market time zone. */
export async function hourlyAccess(tx: Tx, marketId: string, day: string): Promise<HourlyAccessRow[]> {
  if (!isRealDay(day)) throw new AppError("invalid_input", "day must be a real date (YYYY-MM-DD)");
  const rows = await tx`
    with m as (select timezone as tz from markets where id = ${marketId}),
    h as (select generate_series(0, 23) as hour),
    e as (
      select extract(hour from ev.occurred_at at time zone m.tz)::int as hour, count(*)::int as entries
      from access_events ev, m
      where ev.market_id = ${marketId} and (ev.occurred_at at time zone m.tz)::date = ${day}::date
      group by 1
    )
    select h.hour, coalesce(e.entries, 0) as entries from h left join e on e.hour = h.hour order by h.hour`;
  return rows.map((r) => ({ hour: r.hour as number, entries: r.entries as number }));
}
```

- [ ] **Step 4: Rodar os testes e a suíte**

Run: `npx vitest run tests/domain/access-reads.test.ts && npm test && npm run typecheck`
Expected: PASS. Se o `generate_series` com `date - integer` ou o `count(distinct (a, b))` pedirem ajuste de tipo, corrija o mínimo e registre no relatório.

- [ ] **Step 5: Commit**

```bash
git add src/domain/access.ts tests/domain/access-reads.test.ts
git commit -m "feat: read access readers, people, entries and daily summaries"
```

---

### Task 8: Painel do dono (tela Acessos)

**Files:**
- Create: `src/app/o/[orgId]/markets/[marketId]/access/page.tsx`, `.../access/actions.ts`, `.../access/AccessSourceForm.tsx`
- Modify: `src/app/o/[orgId]/markets/[marketId]/page.tsx`

**Interfaces:**
- Consumes: Tarefas 3 e 7 (`createAccessSource`, `revokeAccessSource`, `forgetAccessPerson`, `listAccessSources`, `listAccessPeople`, `listRecentAccess`, `dailyAccessSummary`, `hourlyAccess`), permissões `access:read` e `access:write`.
- Produces: interface apenas; a lógica está coberta pelos testes das Tarefas 3 a 7. Verificação: typecheck, build e o roteiro da Tarefa 9.

- [ ] **Step 1: Ações (`.../access/actions.ts`)**

```ts
"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { redirectOnAppError } from "@/app/action-utils";
import { requireOrg } from "@/auth/guard";
import { withOrg } from "@/db/tenant";
import { createAccessSource, forgetAccessPerson, revokeAccessSource } from "@/domain/access";
import { AppError } from "@/lib/errors";
import { message } from "@/lib/messages";
import { formToObject } from "@/lib/validate";

export type CreateSourceState = { token?: string; name?: string; error?: string };

/** Returns the plain token in the response: it is shown once and never stored or put in a URL. */
export async function createAccessSourceAction(
  orgId: string,
  marketId: string,
  _prev: CreateSourceState,
  fd: FormData,
): Promise<CreateSourceState> {
  try {
    await requireOrg(orgId, "access:write");
    const raw = formToObject(fd);
    const { token } = await withOrg(orgId, (tx) => createAccessSource(tx, orgId, { marketId, name: raw.name }));
    revalidatePath(`/o/${orgId}/markets/${marketId}/access`);
    return { token, name: raw.name };
  } catch (e) {
    if (e instanceof AppError) return { error: message(e.code) };
    throw e;
  }
}

export async function revokeAccessSourceAction(orgId: string, marketId: string, sourceId: string) {
  const path = `/o/${orgId}/markets/${marketId}/access`;
  try {
    await requireOrg(orgId, "access:write");
    await withOrg(orgId, (tx) => revokeAccessSource(tx, sourceId));
  } catch (e) {
    redirectOnAppError(e, path);
  }
  redirect(path);
}

export async function forgetAccessPersonAction(orgId: string, marketId: string, personId: string) {
  const path = `/o/${orgId}/markets/${marketId}/access`;
  try {
    await requireOrg(orgId, "access:write");
    await withOrg(orgId, (tx) => forgetAccessPerson(tx, personId, new Date()));
  } catch (e) {
    redirectOnAppError(e, path);
  }
  redirect(path);
}
```

- [ ] **Step 2: Formulário do leitor (`.../access/AccessSourceForm.tsx`)**

```tsx
"use client";
import { useActionState } from "react";
import { type CreateSourceState, createAccessSourceAction } from "./actions";

export function AccessSourceForm({ orgId, marketId }: { orgId: string; marketId: string }) {
  const [state, formAction, pending] = useActionState<CreateSourceState, FormData>(
    createAccessSourceAction.bind(null, orgId, marketId),
    {},
  );
  return (
    <section>
      <form action={formAction}>
        <label>
          Nome do leitor <input name="name" required minLength={2} maxLength={60} />
        </label>{" "}
        <button type="submit" disabled={pending}>
          Cadastrar leitor
        </button>
      </form>
      {state.error && <p role="alert">{state.error}</p>}
      {state.token && (
        <div role="status">
          <p>
            Leitor <strong>{state.name}</strong> cadastrado. Copie o token agora: ele não será mostrado de novo.
          </p>
          <code style={{ wordBreak: "break-all" }}>{state.token}</code>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 3: Página (`.../access/page.tsx`)**

```tsx
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
```

- [ ] **Step 4: Link na página do mercado**

Em `src/app/o/[orgId]/markets/[marketId]/page.tsx`, logo depois do `<h1>Estoque do mercado</h1>`, acrescentar:

```tsx
      {can(role, "access:read") && (
        <p>
          <a href={`/o/${orgId}/markets/${marketId}/access`}>Acessos</a>
        </p>
      )}
```

(`can` e `role` já existem nessa página.)

- [ ] **Step 5: Verificação**

Run: `npm run typecheck && npm test && npm run build`
Expected: sem erros; o build lista `/o/[orgId]/markets/[marketId]/access`.

- [ ] **Step 6: Commit**

```bash
git add "src/app/o/[orgId]/markets/[marketId]"
git commit -m "feat: show the access log, people and readers to the owner"
```

---

### Task 9: Documentação e verificação final

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: tudo das Tarefas 1 a 8.

- [ ] **Step 1: Atualizar o `README.md`**

Na tabela de fases do topo, acrescentar depois da linha da 5B: `| 6 | Registro de acessos (leitor facial simulado) |`. Depois da seção "NFC-e (fase 5B)" e antes de "Testes", acrescentar:

````markdown
## Acessos (fase 6)

O dono vê quem entra no mercado e quando. Um leitor (por exemplo um leitor facial) manda cada entrada para o Market77; o Market77 **nunca guarda imagem nem template facial**, só o identificador da pessoa e a hora. O nome vem de um cadastro sincronizado com o leitor.

1. Em **Mercados**, abra o mercado e entre em **Acessos** (só o dono vê esta tela). Cadastre um **leitor** e copie o token: ele aparece uma única vez.
2. O leitor envia cada entrada com o token:

```bash
curl -X POST http://localhost:3000/api/access/events \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"occurredAt":"2026-10-05T14:30:00-03:00","eventId":"abc123","personId":"u-42"}'
```

   `eventId` (opcional) evita duplicar a mesma entrada; `personId` (opcional) é o identificador da pessoa no leitor. Só esses campos são guardados. A data pode ter até 5 minutos de adiantamento e 7 dias de atraso.
3. A lista de pessoas é puxada do leitor pela chamada de cada minuto da rota `POST /api/internal/reconcile` (que também responde `access: { synced, purged }`): cada leitor é sincronizado a cada 10 minutos. Quem some da lista do leitor fica inativo.
4. A tela mostra o resumo por dia (entradas, pessoas, vendas pagas e vendas por entrada, no fuso do mercado), as entradas por hora de um dia, os acessos recentes com o nome, as pessoas e os leitores (com o erro da última sincronização, se houver).
5. **Esquecer pessoa** (pedido de exclusão) apaga o nome, tira o identificador dos acessos antigos e impede a sincronização de recriar a pessoa.
6. Os acessos ficam 90 dias; a limpeza roda na mesma chamada de cada minuto.

Rosto é dado biométrico, dado pessoal sensível pela LGPD: a base legal (em geral consentimento específico dos moradores) e o aviso a eles são responsabilidade de quem opera o condomínio.

Ainda não há leitor escolhido: em desenvolvimento a lista de pessoas é simulada (`ACCESS_PROVIDER=fake`):

```bash
curl -X POST http://localhost:3000/api/dev/fake-access/people \
  -d '{"sourceId":"<id do leitor>","people":[{"externalId":"u-42","name":"Ana Souza"}]}'
curl -X POST http://localhost:3000/api/dev/fake-access/mode -d '{"mode":"down"}'   # ok | down
```

O `fake` e essas rotas recusam funcionar com `NODE_ENV=production`. Um leitor real implementa `AccessProvider` (`src/access/provider.ts`) e passa na suíte de contrato `tests/access/access-contract.ts`. Fica para depois: abrir a porta, câmeras, eventos de saída e de acesso negado.
````

- [ ] **Step 2: Verificação automática completa**

Run: `npm run typecheck && npm test && npm run build`
Expected: tudo passa. Registre a contagem de arquivos e de testes.

- [ ] **Step 3: Roteiro HTTP com servidor real**

Com o Postgres do Docker no ar (`docker exec market77-db-1 psql -U market77 market77 -Atc "..."` para consultas; `docker compose exec` não resolve em worktrees), `.env` com `ACCESS_PROVIDER=fake` e `RECONCILE_SECRET`, `npm run db:migrate` e `npm run dev -- -p 3457` em segundo plano. Crie os dados com um script descartável FORA do repositório (pasta de rascunho da sessão; apague-o depois), que fecha os dois pools no fim:

```ts
import { signUp } from "/CAMINHO/DO/REPO/src/auth/service";
import { adminSql, appSql } from "/CAMINHO/DO/REPO/src/db/client";
import { withOrg } from "/CAMINHO/DO/REPO/src/db/tenant";
import { createAccessSource } from "/CAMINHO/DO/REPO/src/domain/access";
import { createMarket } from "/CAMINHO/DO/REPO/src/domain/markets";

(async () => {
  const s = Date.now();
  const owner = await signUp({ email: `ana${s}@x.com`, password: "senha-forte-1", orgName: "Mercados Ana" });
  const o = owner.orgId;
  const market = await withOrg(o, (tx) => createMarket(tx, o, { name: "Loja 6" }));
  const reader = await withOrg(o, (tx) => createAccessSource(tx, o, { marketId: market.id, name: "Porta A" }));
  const stranger = await signUp({ email: `bia${s}@x.com`, password: "senha-bia-123", orgName: "Bia" });
  console.log(JSON.stringify({ org: o, market: market.id, owner: owner.token, source: reader.id, readerToken: reader.token, stranger: stranger.token }));
  await adminSql.end();
  await appSql.end();
})();
```

Executar com `npx tsx --env-file=.env <script>`. Depois, com `curl` (`R` é `-H "x-reconcile-secret: <RECONCILE_SECRET>"`; `T` é o token do leitor), conferir e registrar o comando e a saída crua de cada item:

1. `POST /api/access/events` com o token e `{"occurredAt":"<agora>","eventId":"e1","personId":"u1"}` retorna 201; repetir retorna 200 `{"duplicate":true}`; sem `Authorization` retorna 401 `unauthorized`; token errado retorna 401; data 10 minutos no futuro retorna 400; corpo `{` retorna 400; um corpo com campos extras (`"photo":"XXXX"`) retorna 201 e `select to_jsonb(e)::text from access_events e` não contém `XXXX`.
2. `POST /api/dev/fake-access/people` com `{"sourceId":"<id>","people":[{"externalId":"u1","name":"Ana"},{"externalId":"u2","name":"Bia"}]}` retorna `{"count":2}`; `POST /api/internal/reconcile` (com `R`) retorna `access.synced` 1; a consulta `select external_id, name, active from access_people` mostra as duas pessoas ativas.
3. Eventos com `personId` `u1` (Ana), `u9` (fora do cadastro) e sem `personId`; no painel com o cookie `m77_session=<owner>`, `GET /o/<org>/markets/<market>/access` retorna 200 e contém "Ana", "Pessoa não cadastrada (id u9)", "Não identificada", "Resumo por dia" e "Porta A".
4. Leitor fora do ar: `POST /api/dev/fake-access/mode` com `{"mode":"down"}`; tornar o leitor vencido (`update access_sources set last_sync_at = now() - interval '11 minutes'`); reconciliar; a consulta mostra `last_sync_error` preenchido e as pessoas continuam ativas; o painel mostra "erro na sincronização". Voltar o modo para `ok`, tornar vencido, reconciliar: o erro some.
5. Esquecer pessoa: um `tsx` descartável chama `forgetAccessPerson` (com `withOrg`) para a pessoa `u1`; as consultas mostram `name` nulo, `forgotten_at` preenchido e os eventos antigos de `u1` com `person_external_id` nulo; um novo evento com `personId` `u1` é gravado com `person_external_id` nulo; reconciliar com `u1` ainda na lista do leitor não devolve o nome; o painel contém "Removida a pedido" e não contém "Ana".
6. Retenção: inserir por psql um evento de 100 dias atrás; reconciliar retorna `access.purged` 1 e o evento some; um de 89 dias fica.
7. Resumo: o painel mostra, na linha de hoje, o número de entradas gravadas; `GET .../access?day=2026-10-03` retorna 200 e `GET .../access?day=hoje` retorna 200 com "Dados inválidos".
8. Isolamento e permissões: com o cookie `m77_session=<stranger>`, `GET /o/<org>/markets/<market>/access` retorna 404 e não contém "Ana"; leitor revogado (`update access_sources set revoked_at = now()` ou pela tela) retorna 401 `source_revoked` ao enviar evento.

Encerrar o servidor por completo (`pkill -f "next dev"`; se houver servidor de outra sessão, matar só o processo da porta usada), apagar os scripts descartáveis e conferir que nada ficou rodando (`pgrep -fl "next|tsx"` vazio) e que `git status` está limpo.

- [ ] **Step 4: Roteiro manual no navegador (feito pelo dono do projeto)**

1. Em **Mercados**, abrir um mercado: o link **Acessos** aparece. Cadastrar um leitor: o token aparece uma vez e não volta depois de recarregar a página.
2. Mandar eventos pelo `curl` do README e ver os "Acessos recentes", o "Resumo por dia" (clicar em um dia mostra as entradas por hora) e, depois de preencher a lista de pessoas pelo simulador e chamar a reconciliação, os nomes.
3. **Esquecer pessoa**: abrir o bloco, ler o aviso e confirmar; a pessoa passa a "Removida a pedido" e os acessos dela viram "Não identificada".
4. **Revogar** o leitor: o envio de eventos com o token dele passa a dar 401.
5. Entrar com um usuário **gerente** (cadastrado em **Equipe**): o link **Acessos** não aparece e a URL direta da tela dá 404.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: document phase 6 access log"
```

---

## Auto-revisão

**Cobertura do spec:** seção 2 (decisões) nas Tarefas 2 a 6; seção 3 (dados) na Tarefa 1; seção 4 (ingestão) na Tarefa 4; seção 5 (provedor, sincronização, retenção, esquecer, rota) nas Tarefas 2, 5 e 6; seção 6 (leituras) na Tarefa 7; seção 7 (painel e permissões) nas Tarefas 3 e 8; seção 8 (erros e bordas) distribuída nos testes das Tarefas 4 a 7; seção 9 (testes) distribuída, com os roteiros na Tarefa 9.

**Decisões do plano que o spec não fixava:**
- Na tela, "Removida a pedido" aparece na lista de **pessoas**; nos acessos recentes, os eventos de uma pessoa esquecida aparecem como "Não identificada", porque o identificador foi anulado (o status `forgotten` do spec não existe nas leituras).
- `syncAccessSources` devolve quantos leitores tiveram uma tentativa (com sucesso ou falha) e `last_sync_at` marca cada tentativa, o que limita a uma por 10 minutos mesmo com o equipamento fora do ar.
- O `source_revoked` e o `unauthorized` da ingestão têm mensagens próprias em `src/access/http.ts` (o mapa de erros do PDV fala de "totem").
- A lista de pessoas do `fake-access` é por `sourceId`; um leitor sem lista devolve lista vazia.

**Consistência de tipos:** `SourceAuth` (Tarefa 4) é produzido por `requireSource` e consumido por `recordAccessEvent` e `eventHandler`; `AccessProvider`, `AccessPerson` e `AccessSourceRef` (Tarefa 2) são usados com a mesma forma em `syncOne` (Tarefa 5); os tipos de linha das leituras (Tarefa 7) são consumidos pela página (Tarefa 8) com os mesmos nomes (`activePeople`, `sourceName`, `externalId`, `status`, `salesPerEntry`); `hashAccessToken` (Tarefa 3) é usado por `requireSource` (Tarefa 4) e pelo helper de teste (Tarefa 1, com o mesmo SHA-256 hex).
