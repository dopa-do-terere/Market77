# Fase 7: Mercado Pago (Pix e cartão Point) com credenciais por organização Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pix e cartão reais pela conta Mercado Pago de cada dono (Pix via `/v1/payments`, cartão via Point/Orders API), sem mudar o fluxo do PDV.

**Architecture:** Os dois adaptadores ficam atrás dos contratos `PaymentProvider` e `CardProvider`, que não mudam. O registro passa de global por env para resolvido por organização (`resolvePix(tx)` e `resolveCard(tx)` leem `provider_credentials` sob RLS; sem credenciais, caem no `fake`). O webhook ganha rotas por organização, valida `x-signature` com o segredo da org e consulta a API para obter o estado real.

**Tech Stack:** Next.js (App Router, server actions), postgres.js, zod, Vitest, `node:crypto`, `fetch` nativo (injetável nos testes).

**Spec:** `docs/superpowers/specs/2026-10-05-fase-7-mercadopago-design.md`

## Global Constraints

- Contratos `PaymentProvider` (`src/payments/provider.ts`) e `CardProvider` (`src/payments/card.ts`) não mudam de forma.
- Cartão: `POST /v1/orders` com `type: "point"`, `external_reference` igual ao `saleId`, sem `default_type`, `print_on_terminal: "no_ticket"`. Cancelar: `POST /v1/orders/{id}/cancel`. Consultar: `GET /v1/orders/{id}`.
- Pix: `POST /v1/payments` com `payment_method_id: "pix"`; consultar `GET /v1/payments/{id}`. Valores em reais com duas casas (centavos / 100).
- Segredos: AES-256-GCM, formato `v1:<iv>:<tag>:<dados>` em base64, chave `CREDENTIALS_KEY` (32 bytes em base64). Segredos nunca voltam para a tela, para log, nem para mensagem de erro.
- O corpo de erro do Mercado Pago nunca é copiado para exceção, log ou resposta (pode ter dados do pagador).
- Estado e valor de um pagamento no webhook vêm sempre de `getCharge` (API), nunca do corpo do webhook.
- Toda chamada ao provedor usa `withTimeout` (`src/payments/provider.ts`).
- Webhook: `x-signature` HMAC-SHA256 sobre `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` comparado com `timingSafeEqual`, `ts` com diferença maior que 5 minutos é rejeitado. 22 s é o limite de resposta do Mercado Pago.
- Textos de interface em português; nenhum emoji em código, commits ou arquivos.
- Commits: mensagem em inglês no formato `tipo: resumo`, terminando com a linha `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` (segundo `-m`).
- Testes rodam sem rede. Rodar um arquivo: `npx vitest run <arquivo>`. Suíte toda: `npm test`. Tipos: `npx tsc --noEmit`.

## Review Focus

1. Pix pago depois dos 3 minutos do pagamento Market77 (o Mercado Pago exige expiração mínima de 30 min, então o QR continua válido): a confirmação tardia só vale se o total da venda não mudou; senão fica rejeitada e sinalizada. Teste na Tarefa 6.
2. Webhook repetido ou concorrente: um só `confirmed`, estoque baixa uma vez. Teste na Tarefa 6.
3. Segredo da organização A usado na URL da organização B, ou id de pagamento de outra organização: 401 ou `unknown_payment`, nunca confirma. Teste na Tarefa 6.
4. Vazamento: status de credenciais, mensagens de erro e erro HTTP do adaptador não contêm token, segredo nem corpo da resposta. Testes nas Tarefas 2 e 3.
5. Totem sem `point_device_id` e `CREDENTIALS_KEY` ausente ou adulterada: cartão responde `provider_unavailable`, a venda continua consistente. Testes nas Tarefas 4 e 5.

---

## Estrutura de arquivos

Criar:
- `src/db/migrations/0009_mercadopago.sql`: tabela `provider_credentials`, coluna `terminals.point_device_id`.
- `src/lib/secrets.ts`: `encryptSecret`, `decryptSecret`.
- `src/domain/credentials.ts`: salvar, ler, mostrar estado e remover credenciais Mercado Pago.
- `src/payments/mercadopago-http.ts`: chamada JSON, erro sem corpo, verificação de `x-signature`.
- `src/payments/mercadopago-pix.ts`: adaptador Pix.
- `src/payments/mercadopago-card.ts`: adaptador Point.
- `src/app/api/webhooks/pix/mercadopago/[orgId]/route.ts` e `src/app/api/webhooks/card/mercadopago/[orgId]/route.ts`.
- `src/app/o/[orgId]/settings/payments/page.tsx` e `actions.ts`.
- Testes: `tests/lib/secrets.test.ts`, `tests/db/mercadopago-schema.test.ts`, `tests/domain/credentials.test.ts`, `tests/payments/mp-fetch.ts` (helper), `tests/payments/mercadopago-http.test.ts`, `tests/payments/mercadopago-pix.test.ts`, `tests/payments/mercadopago-card.test.ts`, `tests/payments/registry-org.test.ts`, `tests/payments/mercadopago-webhook.test.ts`.

Modificar: `tests/helpers.ts`, `vitest.config.ts`, `.env.example`, `src/payments/registry.ts`, `src/payments/webhook.ts`, `src/payments/reconcile.ts`, `src/domain/payments.ts`, `src/domain/refresh.ts`, `src/pdv/http.ts`, `src/domain/terminals.ts`, `src/auth/permissions.ts`, `src/lib/messages.ts`, `src/app/o/[orgId]/layout.tsx`, `src/app/o/[orgId]/terminals/{page.tsx,actions.ts,TerminalForm.tsx}`, `README.md`, a spec da fase 7.

Decisão de desenho que difere do spec (registrada na Tarefa 8): o spec previa um cache de credenciais com TTL de 60 s. O plano não tem cache: é uma leitura indexada por chamada, e isso elimina invalidação e estado em memória.

---

### Task 1: Migration 0009 e cifra de segredos

**Files:**
- Create: `src/db/migrations/0009_mercadopago.sql`
- Create: `src/lib/secrets.ts`
- Modify: `tests/helpers.ts` (lista `TABLES`), `vitest.config.ts`, `.env.example`
- Test: `tests/lib/secrets.test.ts`, `tests/db/mercadopago-schema.test.ts`

**Interfaces:**
- Produces: tabela `provider_credentials(id, org_id, provider, access_token_enc, webhook_secret_enc, token_last4, created_at, updated_at)` com `UNIQUE (org_id, provider)` e RLS; coluna `terminals.point_device_id text`; `encryptSecret(plain: string): string`; `decryptSecret(blob: string): string`; `AppError("credentials_key_missing")` quando a chave falta.

- [ ] **Step 1: Escrever o teste de cifra**

`tests/lib/secrets.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import { decryptSecret, encryptSecret } from "@/lib/secrets";

afterEach(() => vi.unstubAllEnvs());

describe("secrets", () => {
  it("round-trips and never repeats the ciphertext", () => {
    const a = encryptSecret("APP_USR-123");
    const b = encryptSecret("APP_USR-123");
    expect(a).not.toBe(b);
    expect(a.startsWith("v1:")).toBe(true);
    expect(a).not.toContain("APP_USR");
    expect(decryptSecret(a)).toBe("APP_USR-123");
  });

  it("fails on a tampered blob", () => {
    const parts = encryptSecret("segredo").split(":");
    parts[3] = Buffer.from("outro").toString("base64");
    expect(() => decryptSecret(parts.join(":"))).toThrow();
  });

  it("fails on a malformed blob", () => {
    expect(() => decryptSecret("lixo")).toThrow();
  });

  it("refuses to work without a valid key", () => {
    for (const bad of ["", Buffer.alloc(16).toString("base64")]) {
      vi.stubEnv("CREDENTIALS_KEY", bad);
      expect(() => encryptSecret("x")).toThrow(AppError);
      try {
        encryptSecret("x");
      } catch (e) {
        expect((e as AppError).code).toBe("credentials_key_missing");
      }
    }
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/lib/secrets.test.ts`
Expected: FAIL (módulo `@/lib/secrets` não existe).

- [ ] **Step 3: Implementar `src/lib/secrets.ts`**

```ts
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { AppError } from "./errors";

function key(): Buffer {
  const k = Buffer.from(process.env.CREDENTIALS_KEY ?? "", "base64");
  if (k.length !== 32) throw new AppError("credentials_key_missing");
  return k;
}

/** AES-256-GCM. Format v1:<iv>:<tag>:<data>, each part in base64 (which never contains a colon). */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), data.toString("base64")].join(":");
}

/** Throws on a malformed or tampered blob. */
export function decryptSecret(blob: string): string {
  const [v, iv, tag, data] = blob.split(":");
  if (v !== "v1" || !iv || !tag || data === undefined) throw new Error("malformed secret");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
}
```

- [ ] **Step 4: Configurar a chave nos testes e no exemplo**

Em `vitest.config.ts`, dentro do objeto `env`, depois de `ACCESS_PROVIDER: "fake",`, acrescentar:

```ts
  CREDENTIALS_KEY: Buffer.alloc(32, 7).toString("base64"),
```

No fim de `.env.example`, acrescentar (a chave de teste não serve para produção):

```
# 32 bytes em base64 (openssl rand -base64 32). Cifra as credenciais Mercado Pago salvas no banco.
CREDENTIALS_KEY=
```

Em `tests/helpers.ts`, na lista `TABLES`, acrescentar `"provider_credentials",` logo antes de `"organizations",`.

- [ ] **Step 5: Rodar o teste de cifra**

Run: `npx vitest run tests/lib/secrets.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 6: Escrever o teste de schema**

`tests/db/mercadopago-schema.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { adminSql } from "@/db/client";
import { withOrg } from "@/db/tenant";
import { makeOrg, resetDb, seedStore } from "../helpers";

beforeEach(resetDb);

const insert = (orgId: string, provider = "mercadopago", last4 = "abcd") =>
  withOrg(orgId, (tx) =>
    tx`insert into provider_credentials (org_id, provider, access_token_enc, webhook_secret_enc, token_last4)
       values (${orgId}, ${provider}, 'v1:a:b:c', 'v1:d:e:f', ${last4})`,
  );

describe("phase 7 schema", () => {
  it("allows one row per organization and provider, and only mercadopago", async () => {
    const orgId = await makeOrg("A");
    await insert(orgId);
    await expect(insert(orgId)).rejects.toThrow(/duplicate|unique/);
    await expect(insert(await makeOrg("B"), "stone")).rejects.toThrow(/check/);
    await expect(insert(await makeOrg("C"), "mercadopago", "abc")).rejects.toThrow(/check/);
  });

  it("isolates credentials by organization", async () => {
    const a = await makeOrg("A");
    const b = await makeOrg("B");
    await insert(a);
    const seenByB = await withOrg(b, (tx) => tx`select id from provider_credentials`);
    expect(seenByB).toHaveLength(0);
    await expect(
      withOrg(b, (tx) =>
        tx`insert into provider_credentials (org_id, provider, access_token_enc, webhook_secret_enc, token_last4)
           values (${a}, 'mercadopago', 'x', 'y', 'abcd')`,
      ),
    ).rejects.toThrow();
  });

  it("limits the Point device id of a terminal", async () => {
    const orgId = await makeOrg("A");
    const { terminalId } = await seedStore(orgId);
    await withOrg(orgId, (tx) => tx`update terminals set point_device_id = 'NEWLAND_N950__X1' where id = ${terminalId}`);
    await expect(
      withOrg(orgId, (tx) => tx`update terminals set point_device_id = '' where id = ${terminalId}`),
    ).rejects.toThrow(/check/);
    await expect(
      adminSql`update terminals set point_device_id = ${"x".repeat(65)} where id = ${terminalId}`,
    ).rejects.toThrow(/check/);
  });
});
```

- [ ] **Step 7: Rodar e ver falhar**

Run: `npx vitest run tests/db/mercadopago-schema.test.ts`
Expected: FAIL (tabela `provider_credentials` não existe).

- [ ] **Step 8: Escrever a migration**

`src/db/migrations/0009_mercadopago.sql`:

```sql
-- Phase 7: Mercado Pago. Credentials per organization (encrypted by the app, never readable as plain text)
-- and the Point machine paired with a totem.
CREATE TABLE provider_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations (id),
  provider text NOT NULL CHECK (provider IN ('mercadopago')),
  access_token_enc text NOT NULL,
  webhook_secret_enc text NOT NULL,
  token_last4 text NOT NULL CHECK (char_length(token_last4) = 4),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, provider)
);

ALTER TABLE provider_credentials ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON provider_credentials
  USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON provider_credentials TO market77_app;

ALTER TABLE terminals ADD COLUMN point_device_id text
  CHECK (point_device_id IS NULL OR char_length(point_device_id) BETWEEN 1 AND 64);
GRANT UPDATE (point_device_id) ON terminals TO market77_app;
```

- [ ] **Step 9: Rodar os testes de schema e de cifra**

Run: `npx vitest run tests/db/mercadopago-schema.test.ts tests/lib/secrets.test.ts`
Expected: PASS. Se `migrate` reclamar de falta de arquivo ou ordem, confira que o arquivo se chama exatamente `0009_mercadopago.sql`.

- [ ] **Step 10: Commit**

```bash
git add src/db/migrations/0009_mercadopago.sql src/lib/secrets.ts tests/lib/secrets.test.ts tests/db/mercadopago-schema.test.ts tests/helpers.ts vitest.config.ts .env.example
git commit -m "feat: encrypted per-organization provider credentials and Point device column" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Domínio de credenciais e maquininha do totem

**Files:**
- Create: `src/domain/credentials.ts`
- Modify: `src/domain/terminals.ts`
- Modify: `src/lib/messages.ts`
- Test: `tests/domain/credentials.test.ts`

**Interfaces:**
- Consumes: `encryptSecret`, `decryptSecret` (Tarefa 1), `parse` de `@/lib/validate`, `Tx` de `@/db/tenant`, `adminSql` de `@/db/client`.
- Produces:
  - `type MercadoPagoCredentials = { accessToken: string; webhookSecret: string }`
  - `type CredentialsStatus = { configured: boolean; last4: string | null; updatedAt: Date | null }`
  - `saveMercadoPagoCredentials(tx: Tx, orgId: string, raw: unknown): Promise<void>`
  - `mercadoPagoStatus(tx: Tx): Promise<CredentialsStatus>`
  - `removeMercadoPagoCredentials(tx: Tx): Promise<void>`
  - `readOwnMercadoPagoCredentials(tx: Tx): Promise<MercadoPagoCredentials | null>` (sob RLS)
  - `readMercadoPagoCredentials(orgId: string): Promise<MercadoPagoCredentials | null>` (usa `adminSql`, para o webhook)
  - `setTerminalDevice(tx: Tx, terminalId: string, raw: unknown): Promise<void>`; `TerminalRow.pointDeviceId: string | null`; `createTerminal` aceita `pointDeviceId` opcional.

- [ ] **Step 1: Escrever os testes**

`tests/domain/credentials.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { adminSql } from "@/db/client";
import { withOrg } from "@/db/tenant";
import {
  mercadoPagoStatus,
  readMercadoPagoCredentials,
  readOwnMercadoPagoCredentials,
  removeMercadoPagoCredentials,
  saveMercadoPagoCredentials,
} from "@/domain/credentials";
import { createTerminal, listTerminals, setTerminalDevice } from "@/domain/terminals";
import { AppError } from "@/lib/errors";
import { makeOrg, resetDb, seedStore } from "../helpers";

beforeEach(resetDb);

const TOKEN = "APP_USR-1234567890-abcdef";
const SECRET = "whsec-super-secreto";
const save = (orgId: string, raw: unknown = { accessToken: TOKEN, webhookSecret: SECRET }) =>
  withOrg(orgId, (tx) => saveMercadoPagoCredentials(tx, orgId, raw));

describe("Mercado Pago credentials", () => {
  it("stores both secrets encrypted and reads them back", async () => {
    const orgId = await makeOrg("A");
    await save(orgId);
    const [row] = await adminSql`select access_token_enc, webhook_secret_enc from provider_credentials`;
    expect(JSON.stringify(row)).not.toContain(TOKEN);
    expect(JSON.stringify(row)).not.toContain(SECRET);
    expect(await withOrg(orgId, (tx) => readOwnMercadoPagoCredentials(tx))).toEqual({
      accessToken: TOKEN,
      webhookSecret: SECRET,
    });
    expect(await readMercadoPagoCredentials(orgId)).toEqual({ accessToken: TOKEN, webhookSecret: SECRET });
  });

  it("shows only the state, never the secrets", async () => {
    const orgId = await makeOrg("A");
    expect(await withOrg(orgId, (tx) => mercadoPagoStatus(tx))).toEqual({
      configured: false,
      last4: null,
      updatedAt: null,
    });
    await save(orgId);
    const status = await withOrg(orgId, (tx) => mercadoPagoStatus(tx));
    expect(status.configured).toBe(true);
    expect(status.last4).toBe("cdef");
    expect(JSON.stringify(status)).not.toContain(SECRET);
    expect(JSON.stringify(status)).not.toContain(TOKEN);
  });

  it("replaces the previous credentials and removes them", async () => {
    const orgId = await makeOrg("A");
    await save(orgId);
    await save(orgId, { accessToken: "APP_USR-novo-token-9999", webhookSecret: "outro-segredo" });
    expect((await readMercadoPagoCredentials(orgId))?.accessToken).toBe("APP_USR-novo-token-9999");
    expect(await adminSql`select 1 from provider_credentials`).toHaveLength(1);
    await withOrg(orgId, (tx) => removeMercadoPagoCredentials(tx));
    expect(await readMercadoPagoCredentials(orgId)).toBeNull();
  });

  it("never lets one organization read or replace another's credentials", async () => {
    const a = await makeOrg("A");
    const b = await makeOrg("B");
    await save(a);
    expect(await withOrg(b, (tx) => readOwnMercadoPagoCredentials(tx))).toBeNull();
    expect(await readMercadoPagoCredentials(b)).toBeNull();
    await withOrg(b, (tx) => removeMercadoPagoCredentials(tx));
    expect(await readMercadoPagoCredentials(a)).not.toBeNull();
  });

  it("rejects malformed input without echoing it", async () => {
    const orgId = await makeOrg("A");
    for (const raw of [
      {},
      { accessToken: "curto", webhookSecret: SECRET },
      { accessToken: TOKEN, webhookSecret: "x" },
      { accessToken: "token com espaco 12345", webhookSecret: SECRET },
      { accessToken: TOKEN, webhookSecret: "segredo\u0000nulo" },
    ]) {
      const err = await save(orgId, raw).catch((e) => e);
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe("invalid_input");
      expect((err as AppError).message).not.toContain("token com espaco");
    }
  });

  it("fails clearly when the server has no encryption key", async () => {
    const orgId = await makeOrg("A");
    vi.stubEnv("CREDENTIALS_KEY", "");
    const err = await save(orgId).catch((e) => e);
    expect((err as AppError).code).toBe("credentials_key_missing");
    vi.unstubAllEnvs();
  });
});

describe("Point device of a terminal", () => {
  it("is set, listed and cleared", async () => {
    const orgId = await makeOrg("A");
    const { terminalId } = await seedStore(orgId);
    await withOrg(orgId, (tx) => setTerminalDevice(tx, terminalId, { pointDeviceId: " NEWLAND_N950__X1 " }));
    expect((await withOrg(orgId, (tx) => listTerminals(tx)))[0].pointDeviceId).toBe("NEWLAND_N950__X1");
    await withOrg(orgId, (tx) => setTerminalDevice(tx, terminalId, {}));
    expect((await withOrg(orgId, (tx) => listTerminals(tx)))[0].pointDeviceId).toBeNull();
  });

  it("can be given when the terminal is created", async () => {
    const orgId = await makeOrg("A");
    const { marketId } = await seedStore(orgId);
    await withOrg(orgId, (tx) =>
      createTerminal(tx, orgId, { marketId, name: "Totem 2", pointDeviceId: "PAX_A910__ABC" }),
    );
    const t = (await withOrg(orgId, (tx) => listTerminals(tx))).find((x) => x.name === "Totem 2");
    expect(t?.pointDeviceId).toBe("PAX_A910__ABC");
  });

  it("rejects an invalid id and a terminal of another organization", async () => {
    const a = await makeOrg("A");
    const b = await makeOrg("B");
    const { terminalId } = await seedStore(a);
    const bad = (raw: unknown, org = a) => withOrg(org, (tx) => setTerminalDevice(tx, terminalId, raw));
    await expect(bad({ pointDeviceId: "com espaco" })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(bad({ pointDeviceId: "x".repeat(65) })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(bad({ pointDeviceId: "OK_ID_1" }, b)).rejects.toMatchObject({ code: "not_found" });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/domain/credentials.test.ts`
Expected: FAIL (módulo `@/domain/credentials` não existe).

- [ ] **Step 3: Implementar `src/domain/credentials.ts`**

```ts
import { z } from "zod";
import { adminSql } from "@/db/client";
import type { Tx } from "@/db/tenant";
import { decryptSecret, encryptSecret } from "@/lib/secrets";
import { parse } from "@/lib/validate";

export type MercadoPagoCredentials = { accessToken: string; webhookSecret: string };
export type CredentialsStatus = { configured: boolean; last4: string | null; updatedAt: Date | null };

// Printable ASCII without spaces: tokens and secrets are copied from the Mercado Pago panel.
const Input = z.object({
  accessToken: z.string().trim().min(10).max(300).regex(/^[\x21-\x7e]+$/),
  webhookSecret: z.string().trim().min(8).max(200).regex(/^[\x21-\x7e]+$/),
});

export async function saveMercadoPagoCredentials(tx: Tx, orgId: string, raw: unknown): Promise<void> {
  const i = parse(Input, raw);
  await tx`
    insert into provider_credentials (org_id, provider, access_token_enc, webhook_secret_enc, token_last4)
    values (${orgId}, 'mercadopago', ${encryptSecret(i.accessToken)}, ${encryptSecret(i.webhookSecret)}, ${i.accessToken.slice(-4)})
    on conflict (org_id, provider) do update set
      access_token_enc = excluded.access_token_enc,
      webhook_secret_enc = excluded.webhook_secret_enc,
      token_last4 = excluded.token_last4,
      updated_at = now()`;
}

/** Only the state: the secrets never leave the server. */
export async function mercadoPagoStatus(tx: Tx): Promise<CredentialsStatus> {
  const [r] = await tx`select token_last4, updated_at from provider_credentials where provider = 'mercadopago'`;
  return r
    ? { configured: true, last4: r.token_last4 as string, updatedAt: r.updated_at as Date }
    : { configured: false, last4: null, updatedAt: null };
}

export async function removeMercadoPagoCredentials(tx: Tx): Promise<void> {
  await tx`delete from provider_credentials where provider = 'mercadopago'`;
}

type Row = { access_token_enc: unknown; webhook_secret_enc: unknown };
const open = (r: Row): MercadoPagoCredentials => ({
  accessToken: decryptSecret(r.access_token_enc as string),
  webhookSecret: decryptSecret(r.webhook_secret_enc as string),
});

/** The organization of the transaction (RLS). Throws when the stored blob cannot be decrypted. */
export async function readOwnMercadoPagoCredentials(tx: Tx): Promise<MercadoPagoCredentials | null> {
  const [r] = await tx`
    select access_token_enc, webhook_secret_enc from provider_credentials where provider = 'mercadopago'`;
  return r ? open(r) : null;
}

/** Without a session (webhook): admin role, always filtered by the organization of the URL. */
export async function readMercadoPagoCredentials(orgId: string): Promise<MercadoPagoCredentials | null> {
  const [r] = await adminSql`
    select access_token_enc, webhook_secret_enc from provider_credentials
    where org_id = ${orgId} and provider = 'mercadopago'`;
  return r ? open(r) : null;
}
```

- [ ] **Step 4: Estender `src/domain/terminals.ts`**

Substituir a linha do `Input` por:

```ts
// Printable ASCII without spaces, as Mercado Pago writes it (for example NEWLAND_N950__N950NCB801293324).
const DeviceId = z.string().trim().min(1).max(64).regex(/^[\x21-\x7e]+$/);
const Input = z.object({
  marketId: z.string().uuid(),
  name: z.string().trim().min(2).max(60),
  pointDeviceId: DeviceId.optional(),
});
```

No tipo `TerminalRow`, acrescentar `pointDeviceId: string | null;` depois de `pdvStatus`.

Em `createTerminal`, trocar o insert por:

```ts
    const [row] = await tx`
      insert into terminals (org_id, market_id, name, token_hash, point_device_id)
      values (${orgId}, ${i.marketId}, ${i.name}, ${hashTerminalToken(token)}, ${i.pointDeviceId ?? null})
      returning id`;
```

Em `listTerminals`, trocar `t.last_heartbeat_at, t.agent_version, t.pdv_status` por `t.last_heartbeat_at, t.agent_version, t.pdv_status, t.point_device_id` e acrescentar ao objeto retornado `pointDeviceId: (r.point_device_id as string | null) ?? null,`.

No fim do arquivo, acrescentar:

```ts
const DeviceInput = z.object({ pointDeviceId: DeviceId.optional() });

/** Pairs the totem with a Mercado Pago Point machine; an empty value clears the pairing. */
export async function setTerminalDevice(tx: Tx, terminalId: string, raw: unknown): Promise<void> {
  if (!z.string().uuid().safeParse(terminalId).success) throw new AppError("not_found");
  const i = parse(DeviceInput, raw);
  const rows = await tx`update terminals set point_device_id = ${i.pointDeviceId ?? null} where id = ${terminalId} returning id`;
  if (rows.length === 0) throw new AppError("not_found");
}
```

- [ ] **Step 5: Mensagens**

Em `src/lib/messages.ts`, antes do `};` que fecha `MESSAGES`, acrescentar:

```ts
  credentials_key_missing: "O servidor não tem a chave de criptografia das credenciais (CREDENTIALS_KEY).",
  credentials_test_failed: "O Mercado Pago recusou o token. Confira se é o access token de produção.",
```

- [ ] **Step 6: Rodar os testes**

Run: `npx vitest run tests/domain/credentials.test.ts && npx tsc --noEmit`
Expected: PASS e sem erros de tipo.

- [ ] **Step 7: Commit**

```bash
git add src/domain/credentials.ts src/domain/terminals.ts src/lib/messages.ts tests/domain/credentials.test.ts
git commit -m "feat: save, read and remove Mercado Pago credentials; pair a totem with a Point machine" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Cliente HTTP, verificação de assinatura e adaptador Pix

**Files:**
- Create: `src/payments/mercadopago-http.ts`, `src/payments/mercadopago-pix.ts`
- Test: `tests/payments/mp-fetch.ts` (helper), `tests/payments/mercadopago-http.test.ts`, `tests/payments/mercadopago-pix.test.ts`

**Interfaces:**
- Consumes: `MercadoPagoCredentials` (Tarefa 2), `PaymentProvider`, `ChargeStatus` de `@/payments/provider`.
- Produces:
  - `type Fetch = typeof fetch`; `MP_API = "https://api.mercadopago.com"`
  - `class MercadoPagoError extends Error { status: number }` (mensagem fixa, sem corpo)
  - `mpCall(creds, f, method: "GET" | "POST", path: string, o?: { body?: unknown; idempotencyKey?: string }): Promise<unknown>`
  - `type Notification = { kind: "payment" | "order"; id: string }`
  - `verifyNotification(secret: string, headers: Headers, rawBody: string, url: URL, now: Date): Notification | null` (lança se a assinatura for inválida)
  - `mercadoPagoPix(creds, f?: Fetch, clock?: () => Date): PaymentProvider` com `name: "mercadopago"`
  - helper de teste `fakeFetch(handler)` e `signNotification(secret, o)`.

- [ ] **Step 1: Helper de teste**

`tests/payments/mp-fetch.ts`:

```ts
import { createHmac } from "node:crypto";

export type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };
type Reply = { status?: number; json?: unknown };

/** A fetch that answers from a function and records every call. No network. */
export function fakeFetch(handler: (c: Call) => Reply) {
  const calls: Call[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    const r = handler(call);
    return new Response(JSON.stringify(r.json ?? {}), {
      status: r.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { f, calls };
}

/** Builds the headers Mercado Pago would send for a notification about data.id. */
export function signNotification(
  secret: string,
  o: { id: string; ts?: number; requestId?: string; secretOverride?: string },
): Headers {
  const ts = o.ts ?? Math.floor(Date.now() / 1000);
  const requestId = o.requestId ?? "req-1";
  const id = /^[a-z0-9]+$/i.test(o.id) ? o.id.toLowerCase() : o.id;
  const v1 = createHmac("sha256", o.secretOverride ?? secret)
    .update(`id:${id};request-id:${requestId};ts:${ts};`)
    .digest("hex");
  return new Headers({ "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": requestId });
}
```

- [ ] **Step 2: Teste do cliente e da assinatura**

`tests/payments/mercadopago-http.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MercadoPagoError, mpCall, verifyNotification } from "@/payments/mercadopago-http";
import { fakeFetch, signNotification } from "./mp-fetch";

const CREDS = { accessToken: "APP_USR-token-1234", webhookSecret: "whsec-123456" };
const NOW = new Date("2026-10-05T12:00:00Z");
const ts = (d: Date) => Math.floor(d.getTime() / 1000);
const url = (id: string) => new URL(`https://app.example/api/webhooks/pix/mercadopago/org?data.id=${id}&type=payment`);
const body = (type: string, id: string) => JSON.stringify({ type, action: `${type}.updated`, data: { id } });

describe("mpCall", () => {
  it("sends the bearer token and the idempotency key", async () => {
    const { f, calls } = fakeFetch(() => ({ json: { ok: true } }));
    await mpCall(CREDS, f, "POST", "/v1/payments", { body: { a: 1 }, idempotencyKey: "k1" });
    expect(calls[0].url).toBe("https://api.mercadopago.com/v1/payments");
    expect(calls[0].headers.Authorization).toBe("Bearer APP_USR-token-1234");
    expect(calls[0].headers["X-Idempotency-Key"]).toBe("k1");
    expect(calls[0].body).toEqual({ a: 1 });
  });

  it("throws an error that carries the status and nothing of the response", async () => {
    const { f } = fakeFetch(() => ({ status: 401, json: { message: "payer ana@example.com" } }));
    const err = await mpCall(CREDS, f, "GET", "/x").catch((e) => e);
    expect(err).toBeInstanceOf(MercadoPagoError);
    expect(err.status).toBe(401);
    expect(String(err.message)).not.toContain("ana@example.com");
    expect(JSON.stringify(err)).not.toContain("ana@example.com");
  });
});

describe("verifyNotification", () => {
  const secret = CREDS.webhookSecret;
  const ok = (id = "123456", type = "payment", at = NOW) =>
    verifyNotification(secret, signNotification(secret, { id, ts: ts(at) }), body(type, id), url(id), NOW);

  it("accepts a genuine payment and a genuine order notification", () => {
    expect(ok()).toEqual({ kind: "payment", id: "123456" });
    expect(ok("ORD01ABC", "order")).toEqual({ kind: "order", id: "ORD01ABC" });
  });

  it("accepts a millisecond timestamp", () => {
    const h = signNotification(secret, { id: "1", ts: NOW.getTime() });
    expect(verifyNotification(secret, h, body("payment", "1"), url("1"), NOW)).toEqual({ kind: "payment", id: "1" });
  });

  it("returns null for another topic after checking the signature", () => {
    expect(ok("1", "merchant_order")).toBeNull();
  });

  it("rejects a wrong secret, a changed id, a missing header and garbage", () => {
    const h = signNotification(secret, { id: "123456", ts: ts(NOW), secretOverride: "outro-segredo" });
    expect(() => verifyNotification(secret, h, body("payment", "123456"), url("123456"), NOW)).toThrow();
    const good = signNotification(secret, { id: "123456", ts: ts(NOW) });
    expect(() => verifyNotification(secret, good, body("payment", "999"), url("999"), NOW)).toThrow();
    expect(() => verifyNotification(secret, new Headers(), body("payment", "1"), url("1"), NOW)).toThrow();
    expect(() => verifyNotification(secret, good, "nao e json", url("1"), NOW)).toThrow();
    const hex = new Headers({ "x-signature": `ts=${ts(NOW)},v1=zz`, "x-request-id": "req-1" });
    expect(() => verifyNotification(secret, hex, body("payment", "1"), url("1"), NOW)).toThrow();
  });

  it("rejects an old or future timestamp", () => {
    expect(() => ok("1", "payment", new Date(NOW.getTime() - 6 * 60_000))).toThrow();
    expect(() => ok("1", "payment", new Date(NOW.getTime() + 6 * 60_000))).toThrow();
  });

  it("falls back to the id in the body when the query has none", () => {
    const h = signNotification(secret, { id: "777", ts: ts(NOW) });
    expect(
      verifyNotification(secret, h, body("payment", "777"), new URL("https://app.example/x"), NOW),
    ).toEqual({ kind: "payment", id: "777" });
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest run tests/payments/mercadopago-http.test.ts`
Expected: FAIL (módulo não existe).

- [ ] **Step 4: Implementar `src/payments/mercadopago-http.ts`**

```ts
import { createHmac, timingSafeEqual } from "node:crypto";
import type { MercadoPagoCredentials } from "@/domain/credentials";

export const MP_API = "https://api.mercadopago.com";
export type Fetch = typeof fetch;

/** Carries the HTTP status only: the response body may hold payer data and must never reach a log or a client. */
export class MercadoPagoError extends Error {
  constructor(readonly status: number) {
    super(`mercadopago http ${status}`);
    this.name = "MercadoPagoError";
  }
}

export async function mpCall(
  creds: MercadoPagoCredentials,
  f: Fetch,
  method: "GET" | "POST",
  path: string,
  o: { body?: unknown; idempotencyKey?: string } = {},
): Promise<unknown> {
  const res = await f(`${MP_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${creds.accessToken}`,
      "Content-Type": "application/json",
      ...(o.idempotencyKey ? { "X-Idempotency-Key": o.idempotencyKey } : {}),
    },
    body: o.body === undefined ? undefined : JSON.stringify(o.body),
  });
  if (!res.ok) throw new MercadoPagoError(res.status);
  return res.json();
}

export type Notification = { kind: "payment" | "order"; id: string };

const MAX_SKEW_MS = 5 * 60_000;

/**
 * Validates x-signature (HMAC-SHA256 of "id:<data.id>;request-id:<x-request-id>;ts:<ts>;") and says what changed.
 * Throws when the signature or the timestamp is not valid; null for a topic we do not use.
 * The notification only says "this id changed": the state always comes from the API.
 */
export function verifyNotification(
  secret: string,
  headers: Headers,
  rawBody: string,
  url: URL,
  now: Date,
): Notification | null {
  let body: { type?: unknown; data?: { id?: unknown } };
  try {
    body = JSON.parse(rawBody);
  } catch {
    throw new Error("invalid body");
  }
  const rawId = url.searchParams.get("data.id") ?? body?.data?.id;
  const id = rawId === undefined || rawId === null ? "" : String(rawId);
  const parts = new Map(
    (headers.get("x-signature") ?? "").split(",").map((p) => {
      const i = p.indexOf("=");
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()] as const;
    }),
  );
  const ts = parts.get("ts");
  const v1 = parts.get("v1");
  if (!ts || !v1 || !id) throw new Error("invalid signature");
  const manifestId = /^[a-z0-9]+$/i.test(id) ? id.toLowerCase() : id;
  const manifest = `id:${manifestId};request-id:${headers.get("x-request-id") ?? ""};ts:${ts};`;
  const want = createHmac("sha256", secret).update(manifest).digest();
  const given = Buffer.from(v1, "hex");
  if (given.length !== want.length || !timingSafeEqual(given, want)) throw new Error("invalid signature");
  const n = Number(ts);
  const sentAt = n > 1e12 ? n : n * 1000; // seconds or milliseconds
  if (!Number.isFinite(sentAt) || Math.abs(now.getTime() - sentAt) > MAX_SKEW_MS) throw new Error("stale signature");
  if (body.type === "payment") return { kind: "payment", id };
  if (body.type === "order") return { kind: "order", id };
  return null;
}
```

- [ ] **Step 5: Rodar**

Run: `npx vitest run tests/payments/mercadopago-http.test.ts`
Expected: PASS.

- [ ] **Step 6: Teste do adaptador Pix**

`tests/payments/mercadopago-pix.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MercadoPagoError } from "@/payments/mercadopago-http";
import { mercadoPagoPix } from "@/payments/mercadopago-pix";
import { fakeFetch } from "./mp-fetch";

const CREDS = { accessToken: "APP_USR-token-1234", webhookSecret: "whsec-123456" };
const NOW = new Date("2026-10-05T12:00:00Z");
const clock = () => NOW;
const expiresAt = new Date("2026-10-05T12:03:00Z");

describe("mercadoPagoPix", () => {
  it("creates a Pix payment and returns the copy-and-paste code", async () => {
    const { f, calls } = fakeFetch(() => ({
      status: 201,
      json: { id: 987654, status: "pending", point_of_interaction: { transaction_data: { qr_code: "000201PIX" } } },
    }));
    const c = await mercadoPagoPix(CREDS, f, clock).createPixCharge({ saleId: "sale-1", amountCents: 1250, expiresAt });
    expect(c).toEqual({ externalId: "987654", qrPayload: "000201PIX", expiresAt });
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toBe("https://api.mercadopago.com/v1/payments");
    expect(calls[0].headers["X-Idempotency-Key"]).toBe(`sale-1:${expiresAt.getTime()}`);
    const body = calls[0].body as Record<string, unknown>;
    expect(body.transaction_amount).toBe(12.5);
    expect(body.payment_method_id).toBe("pix");
    expect(body.external_reference).toBe("sale-1");
    expect((body.payer as { email: string }).email).toMatch(/@/);
  });

  it("asks Mercado Pago for at least 31 minutes, because it refuses a shorter Pix", async () => {
    const { f, calls } = fakeFetch(() => ({
      json: { id: 1, point_of_interaction: { transaction_data: { qr_code: "x" } } },
    }));
    await mercadoPagoPix(CREDS, f, clock).createPixCharge({ saleId: "s", amountCents: 100, expiresAt });
    const sent = new Date((calls[0].body as { date_of_expiration: string }).date_of_expiration);
    expect(sent.getTime() - NOW.getTime()).toBeGreaterThanOrEqual(31 * 60_000);
  });

  it("fails when the answer has no QR code", async () => {
    const { f } = fakeFetch(() => ({ json: { id: 1 } }));
    await expect(
      mercadoPagoPix(CREDS, f, clock).createPixCharge({ saleId: "s", amountCents: 100, expiresAt }),
    ).rejects.toThrow();
  });

  it.each([
    ["approved", undefined, "confirmed"],
    ["pending", "pending_waiting_transfer", "pending"],
    ["in_process", undefined, "pending"],
    ["authorized", undefined, "pending"],
    ["rejected", undefined, "failed"],
    ["cancelled", "by_collector", "failed"],
    ["cancelled", "expired", "expired"],
    ["refunded", undefined, "failed"],
    ["charged_back", undefined, "failed"],
  ])("maps %s (%s) to %s and converts the amount to cents", async (status, detail, expected) => {
    const { f, calls } = fakeFetch(() => ({
      json: { id: 55, status, status_detail: detail, transaction_amount: 12.35 },
    }));
    const r = await mercadoPagoPix(CREDS, f, clock).getCharge("55");
    expect(r).toEqual({ status: expected, amountCents: 1235 });
    expect(calls[0].method).toBe("GET");
    expect(calls[0].url).toBe("https://api.mercadopago.com/v1/payments/55");
  });

  it("treats an unknown status as an error, not as a state", async () => {
    const { f } = fakeFetch(() => ({ json: { status: "algo_novo", transaction_amount: 1 } }));
    await expect(mercadoPagoPix(CREDS, f, clock).getCharge("1")).rejects.toThrow();
  });

  it("does not leak the response body when Mercado Pago fails", async () => {
    const { f } = fakeFetch(() => ({ status: 500, json: { payer: { email: "ana@example.com" } } }));
    const err = await mercadoPagoPix(CREDS, f, clock).getCharge("1").catch((e) => e);
    expect(err).toBeInstanceOf(MercadoPagoError);
    expect(String(err.message)).not.toContain("ana@example.com");
  });

  it("is not reachable through the generic webhook parser", () => {
    expect(() => mercadoPagoPix(CREDS, fakeFetch(() => ({})).f).parseWebhook(new Headers(), "{}")).toThrow(
      /handleMercadoPagoWebhook/,
    );
  });
});
```

- [ ] **Step 7: Rodar e ver falhar**

Run: `npx vitest run tests/payments/mercadopago-pix.test.ts`
Expected: FAIL (módulo não existe).

- [ ] **Step 8: Implementar `src/payments/mercadopago-pix.ts`**

```ts
import { z } from "zod";
import type { MercadoPagoCredentials } from "@/domain/credentials";
import { type Fetch, mpCall } from "./mercadopago-http";
import type { ChargeStatus, PaymentProvider } from "./provider";

const MIN_EXPIRY_MS = 31 * 60_000; // Mercado Pago refuses a Pix that expires in less than 30 minutes

const Created = z.object({
  id: z.union([z.string(), z.number()]),
  point_of_interaction: z.object({ transaction_data: z.object({ qr_code: z.string().min(1) }) }),
});
const Payment = z.object({
  status: z.string(),
  status_detail: z.string().nullish(),
  transaction_amount: z.number(),
});

function toStatus(status: string, detail: string | null | undefined): ChargeStatus {
  switch (status) {
    case "approved":
      return "confirmed";
    case "pending":
    case "in_process":
    case "authorized":
      return "pending";
    case "cancelled":
      return detail === "expired" ? "expired" : "failed";
    case "rejected":
    case "refunded":
    case "charged_back":
      return "failed";
    default:
      throw new Error(`unknown mercadopago status ${status}`);
  }
}

/**
 * Pix through the Payments API. The Market77 payment expires sooner than the Pix does (the provider needs
 * 30 minutes at least); a late approval is still checked against the sale total by confirmPayment.
 */
export function mercadoPagoPix(
  creds: MercadoPagoCredentials,
  f: Fetch = fetch,
  clock: () => Date = () => new Date(),
  payerEmail = "cliente@market77.invalid",
): PaymentProvider {
  return {
    name: "mercadopago",

    async createPixCharge({ saleId, amountCents, expiresAt }) {
      const providerExpiry = new Date(Math.max(expiresAt.getTime(), clock().getTime() + MIN_EXPIRY_MS));
      const r = Created.parse(
        await mpCall(creds, f, "POST", "/v1/payments", {
          idempotencyKey: `${saleId}:${expiresAt.getTime()}`,
          body: {
            transaction_amount: Number((amountCents / 100).toFixed(2)),
            payment_method_id: "pix",
            date_of_expiration: providerExpiry.toISOString(),
            external_reference: saleId,
            description: "Compra no totem",
            payer: { email: payerEmail },
          },
        }),
      );
      return { externalId: String(r.id), qrPayload: r.point_of_interaction.transaction_data.qr_code, expiresAt };
    },

    async getCharge(externalId) {
      const p = Payment.parse(await mpCall(creds, f, "GET", `/v1/payments/${encodeURIComponent(externalId)}`));
      return { status: toStatus(p.status, p.status_detail), amountCents: Math.round(p.transaction_amount * 100) };
    },

    parseWebhook() {
      // Notifications only say that an id changed: handleMercadoPagoWebhook verifies and asks the API.
      throw new Error("mercadopago notifications go through handleMercadoPagoWebhook");
    },
  };
}
```

- [ ] **Step 9: Rodar**

Run: `npx vitest run tests/payments/mercadopago-http.test.ts tests/payments/mercadopago-pix.test.ts && npx tsc --noEmit`
Expected: PASS e sem erros de tipo.

- [ ] **Step 10: Commit**

```bash
git add src/payments/mercadopago-http.ts src/payments/mercadopago-pix.ts tests/payments/mp-fetch.ts tests/payments/mercadopago-http.test.ts tests/payments/mercadopago-pix.test.ts
git commit -m "feat: Mercado Pago HTTP client, notification signature check and Pix adapter" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Adaptador de cartão (Point)

**Files:**
- Create: `src/payments/mercadopago-card.ts`
- Test: `tests/payments/mercadopago-card.test.ts`

**Interfaces:**
- Consumes: `mpCall`, `MercadoPagoError`, `Fetch` (Tarefa 3), `CardProvider`, `CardFailure` de `@/payments/card`.
- Produces: `mercadoPagoPoint(creds, deviceFor: (terminalId: string) => Promise<string | null>, f?: Fetch, clock?: () => Date): CardProvider` com `name: "mercadopago"`.

- [ ] **Step 1: Escrever o teste**

`tests/payments/mercadopago-card.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mercadoPagoPoint } from "@/payments/mercadopago-card";
import { type Call, fakeFetch } from "./mp-fetch";

const CREDS = { accessToken: "APP_USR-token-1234", webhookSecret: "whsec-123456" };
const NOW = new Date("2026-10-05T12:00:00Z");
const clock = () => NOW;
const expiresAt = new Date("2026-10-05T12:02:00Z");
const device = async () => "NEWLAND_N950__X1";
const args = { saleId: "sale-1", amountCents: 2400, terminalId: "totem-1", expiresAt };

const order = (status: string, extra: Record<string, unknown> = {}) => ({
  id: "ORD01",
  status,
  total_amount: "24.00",
  ...extra,
});

describe("mercadoPagoPoint", () => {
  it("creates a Point order for the paired machine", async () => {
    const { f, calls } = fakeFetch(() => ({ status: 201, json: order("created") }));
    const c = await mercadoPagoPoint(CREDS, device, f, clock).createCardCharge(args);
    expect(c).toEqual({ externalId: "ORD01", expiresAt });
    expect(calls[0].url).toBe("https://api.mercadopago.com/v1/orders");
    expect(calls[0].headers["X-Idempotency-Key"]).toBe(`sale-1:${expiresAt.getTime()}`);
    expect(calls[0].body).toEqual({
      type: "point",
      external_reference: "sale-1",
      expiration_time: "PT2M",
      transactions: { payments: [{ amount: "24.00" }] },
      config: { point: { terminal_id: "NEWLAND_N950__X1", print_on_terminal: "no_ticket" } },
      description: "Compra no totem",
    });
  });

  it("never fixes debit or credit: the customer picks on the machine", async () => {
    const { f, calls } = fakeFetch(() => ({ json: order("created") }));
    await mercadoPagoPoint(CREDS, device, f, clock).createCardCharge(args);
    expect(JSON.stringify(calls[0].body)).not.toContain("default_type");
  });

  it("fails without calling Mercado Pago when the totem has no machine", async () => {
    const { f, calls } = fakeFetch(() => ({ json: order("created") }));
    await expect(mercadoPagoPoint(CREDS, async () => null, f, clock).createCardCharge(args)).rejects.toThrow(
      /no Point/,
    );
    expect(calls).toHaveLength(0);
  });

  it.each([
    ["created", {}, "pending", undefined],
    ["at_terminal", {}, "pending", undefined],
    ["action_required", {}, "pending", undefined],
    ["processed", {}, "confirmed", undefined],
    ["canceled", {}, "failed", "cancelled"],
    ["failed", {}, "failed", "declined"],
    ["refunded", {}, "failed", "cancelled"],
    ["expired", {}, "expired", undefined],
  ])("maps order status %s to %s", async (status, extra, expected, reason) => {
    const { f, calls } = fakeFetch(() => ({ json: order(status, extra) }));
    const r = await mercadoPagoPoint(CREDS, device, f, clock).getCharge("ORD01");
    expect(r).toEqual({ status: expected, amountCents: 2400, ...(reason ? { failureReason: reason } : {}) });
    expect(calls[0].url).toBe("https://api.mercadopago.com/v1/orders/ORD01");
  });

  it("reads the amount from the first payment when the total is missing", async () => {
    const { f } = fakeFetch(() => ({
      json: { status: "processed", transactions: { payments: [{ amount: "5.50" }] } },
    }));
    expect((await mercadoPagoPoint(CREDS, device, f, clock).getCharge("o")).amountCents).toBe(550);
  });

  it("treats an unknown status as an error", async () => {
    const { f } = fakeFetch(() => ({ json: order("algo_novo") }));
    await expect(mercadoPagoPoint(CREDS, device, f, clock).getCharge("o")).rejects.toThrow();
  });

  it("cancels a pending order", async () => {
    const { f, calls } = fakeFetch(() => ({ json: order("canceled") }));
    await mercadoPagoPoint(CREDS, device, f, clock).cancelCardCharge("ORD01");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toBe("https://api.mercadopago.com/v1/orders/ORD01/cancel");
  });

  it("is idempotent: a refused cancel is fine when the order is already over", async () => {
    for (const final of ["canceled", "processed", "failed", "expired"]) {
      const { f } = fakeFetch((c: Call) =>
        c.url.endsWith("/cancel") ? { status: 409, json: {} } : { json: order(final) },
      );
      await expect(mercadoPagoPoint(CREDS, device, f, clock).cancelCardCharge("ORD01")).resolves.toBeUndefined();
    }
  });

  it("surfaces a refused cancel when the machine may still be waiting", async () => {
    const { f } = fakeFetch((c: Call) =>
      c.url.endsWith("/cancel") ? { status: 500, json: {} } : { json: order("at_terminal") },
    );
    await expect(mercadoPagoPoint(CREDS, device, f, clock).cancelCardCharge("ORD01")).rejects.toThrow(
      /mercadopago http 500/,
    );
  });

  it("does not hide a transport error behind the idempotency check", async () => {
    const f = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    await expect(mercadoPagoPoint(CREDS, device, f, clock).cancelCardCharge("ORD01")).rejects.toThrow(
      /network down/,
    );
  });

  it("is not reachable through the generic webhook parser", () => {
    expect(() => mercadoPagoPoint(CREDS, device, fakeFetch(() => ({})).f).parseWebhook(new Headers(), "{}")).toThrow(
      /handleMercadoPagoWebhook/,
    );
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/payments/mercadopago-card.test.ts`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar `src/payments/mercadopago-card.ts`**

```ts
import { z } from "zod";
import type { MercadoPagoCredentials } from "@/domain/credentials";
import type { CardFailure, CardProvider } from "./card";
import { type Fetch, MercadoPagoError, mpCall } from "./mercadopago-http";
import type { ChargeStatus } from "./provider";

const Created = z.object({ id: z.string().min(1) });
const Order = z.object({
  status: z.string(),
  total_amount: z.union([z.string(), z.number()]).nullish(),
  transactions: z.object({ payments: z.array(z.object({ amount: z.union([z.string(), z.number()]) })) }).nullish(),
});

function toState(status: string): { status: ChargeStatus; failureReason?: CardFailure } {
  switch (status) {
    case "created":
    case "at_terminal":
    case "action_required":
      return { status: "pending" };
    case "processed":
      return { status: "confirmed" };
    case "canceled":
    case "refunded":
      return { status: "failed", failureReason: "cancelled" };
    case "failed":
      return { status: "failed", failureReason: "declined" };
    case "expired":
      return { status: "expired" };
    default:
      throw new Error(`unknown mercadopago order status ${status}`);
  }
}

/**
 * Card on a Mercado Pago Point machine, through the Orders API. The charge is an order sent to the machine
 * paired with the totem; debit or credit is chosen on the machine. deviceFor maps a Market77 terminal to its
 * Point id (terminals.point_device_id).
 */
export function mercadoPagoPoint(
  creds: MercadoPagoCredentials,
  deviceFor: (terminalId: string) => Promise<string | null>,
  f: Fetch = fetch,
  clock: () => Date = () => new Date(),
): CardProvider {
  async function getCharge(externalId: string) {
    const o = Order.parse(await mpCall(creds, f, "GET", `/v1/orders/${encodeURIComponent(externalId)}`));
    const amount = o.total_amount ?? o.transactions?.payments[0]?.amount;
    if (amount === undefined) throw new Error("mercadopago order without amount");
    return { ...toState(o.status), amountCents: Math.round(Number(amount) * 100) };
  }

  return {
    name: "mercadopago",

    async createCardCharge({ saleId, amountCents, terminalId, expiresAt }) {
      const device = await deviceFor(terminalId);
      if (!device) throw new Error("no Point machine paired with this terminal");
      const minutes = Math.max(1, Math.ceil((expiresAt.getTime() - clock().getTime()) / 60_000));
      const r = Created.parse(
        await mpCall(creds, f, "POST", "/v1/orders", {
          idempotencyKey: `${saleId}:${expiresAt.getTime()}`,
          body: {
            type: "point",
            external_reference: saleId,
            expiration_time: `PT${minutes}M`,
            transactions: { payments: [{ amount: (amountCents / 100).toFixed(2) }] },
            config: { point: { terminal_id: device, print_on_terminal: "no_ticket" } },
            description: "Compra no totem",
          },
        }),
      );
      return { externalId: r.id, expiresAt };
    },

    async cancelCardCharge(externalId) {
      try {
        await mpCall(creds, f, "POST", `/v1/orders/${encodeURIComponent(externalId)}/cancel`);
      } catch (e) {
        if (!(e instanceof MercadoPagoError)) throw e;
        // Refused: fine when the order is already over (cancelled, paid, expired); otherwise the machine may still wait.
        if ((await getCharge(externalId)).status === "pending") throw e;
      }
    },

    getCharge,

    parseWebhook() {
      // Notifications only say that an id changed: handleMercadoPagoWebhook verifies and asks the API.
      throw new Error("mercadopago notifications go through handleMercadoPagoWebhook");
    },
  };
}
```

- [ ] **Step 4: Rodar**

Run: `npx vitest run tests/payments/mercadopago-card.test.ts && npx tsc --noEmit`
Expected: PASS e sem erros de tipo.

- [ ] **Step 5: Commit**

```bash
git add src/payments/mercadopago-card.ts tests/payments/mercadopago-card.test.ts
git commit -m "feat: Mercado Pago Point card adapter" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Registro por organização e ligação nos pontos de chamada

**Files:**
- Modify: `src/payments/registry.ts`, `src/domain/payments.ts`, `src/domain/refresh.ts`, `src/pdv/http.ts`, `src/payments/reconcile.ts`
- Modify: `vitest.config.ts` (remover `PIX_PROVIDER` e `CARD_PROVIDER`), `.env.example` (idem)
- Test: `tests/payments/registry-org.test.ts`

**Interfaces:**
- Consumes: `readOwnMercadoPagoCredentials` (Tarefa 2), `mercadoPagoPix` (Tarefa 3), `mercadoPagoPoint` (Tarefa 4), `Fetch`.
- Produces: `resolvePix(tx: Tx, f?: Fetch): Promise<PaymentProvider>` e `resolveCard(tx: Tx, f?: Fetch): Promise<CardProvider>`. Sem credenciais devolvem o `fake`; erro ao ler ou decifrar vira `AppError("provider_unavailable")`. `getProvider(name = "fake")` e `getCardProvider(name = "fake")` continuam existindo (rotas antigas e testes).

- [ ] **Step 1: Escrever o teste**

`tests/payments/registry-org.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { adminSql } from "@/db/client";
import { withOrg } from "@/db/tenant";
import { saveMercadoPagoCredentials } from "@/domain/credentials";
import { setTerminalDevice } from "@/domain/terminals";
import { startPayment } from "@/domain/payments";
import { addItemByBarcode } from "@/domain/sales";
import { resolveCard, resolvePix } from "@/payments/registry";
import { makeOrg, resetDb, seedSellable, seedStore } from "../helpers";
import { fakeFetch } from "./mp-fetch";

beforeEach(resetDb);

const CREDS = { accessToken: "APP_USR-token-1234", webhookSecret: "whsec-123456" };
const NOW = new Date("2026-10-05T12:00:00Z");
const connect = (orgId: string) => withOrg(orgId, (tx) => saveMercadoPagoCredentials(tx, orgId, CREDS));

describe("per-organization provider registry", () => {
  it("falls back to the fake provider without credentials", async () => {
    const orgId = await makeOrg("A");
    expect((await withOrg(orgId, (tx) => resolvePix(tx))).name).toBe("fake");
    expect((await withOrg(orgId, (tx) => resolveCard(tx))).name).toBe("fake");
  });

  it("uses Mercado Pago for the organization that connected it, and only for it", async () => {
    const a = await makeOrg("A");
    const b = await makeOrg("B");
    await connect(a);
    expect((await withOrg(a, (tx) => resolvePix(tx))).name).toBe("mercadopago");
    expect((await withOrg(a, (tx) => resolveCard(tx))).name).toBe("mercadopago");
    expect((await withOrg(b, (tx) => resolvePix(tx))).name).toBe("fake");
    expect((await withOrg(b, (tx) => resolveCard(tx))).name).toBe("fake");
  });

  it("uses the credentials of the organization in every call", async () => {
    const a = await makeOrg("A");
    await connect(a);
    const { f, calls } = fakeFetch(() => ({
      json: { id: 1, point_of_interaction: { transaction_data: { qr_code: "x" } } },
    }));
    const p = await withOrg(a, (tx) => resolvePix(tx, f));
    await p.createPixCharge({ saleId: "s", amountCents: 100, expiresAt: new Date(NOW.getTime() + 180_000) });
    expect(calls[0].headers.Authorization).toBe(`Bearer ${CREDS.accessToken}`);
  });

  it("goes back to the fake provider after the credentials are removed", async () => {
    const a = await makeOrg("A");
    await connect(a);
    await adminSql`delete from provider_credentials`;
    expect((await withOrg(a, (tx) => resolvePix(tx))).name).toBe("fake");
  });

  it("answers provider_unavailable when the stored secret cannot be decrypted", async () => {
    const a = await makeOrg("A");
    await connect(a);
    await adminSql`update provider_credentials set access_token_enc = 'v1:AAAA:AAAA:AAAA'`;
    await expect(withOrg(a, (tx) => resolvePix(tx))).rejects.toMatchObject({ code: "provider_unavailable" });
    await expect(withOrg(a, (tx) => resolveCard(tx))).rejects.toMatchObject({ code: "provider_unavailable" });
  });

  it("answers provider_unavailable when the server lost its key", async () => {
    const a = await makeOrg("A");
    await connect(a);
    vi.stubEnv("CREDENTIALS_KEY", "");
    await expect(withOrg(a, (tx) => resolvePix(tx))).rejects.toMatchObject({ code: "provider_unavailable" });
    vi.unstubAllEnvs();
  });

  it("sends the card charge to the Point machine of the totem", async () => {
    const a = await makeOrg("A");
    const { terminalId } = await seedStore(a);
    await connect(a);
    await withOrg(a, (tx) => setTerminalDevice(tx, terminalId, { pointDeviceId: "NEWLAND_N950__X1" }));
    const { f, calls } = fakeFetch(() => ({ json: { id: "ORD1", status: "created", total_amount: "1.00" } }));
    const card = await withOrg(a, (tx) => resolveCard(tx, f));
    await card.createCardCharge({
      saleId: "s",
      amountCents: 100,
      terminalId,
      expiresAt: new Date(Date.now() + 120_000),
    });
    expect((calls[0].body as { config: { point: { terminal_id: string } } }).config.point.terminal_id).toBe(
      "NEWLAND_N950__X1",
    );
  });

  it("a totem without a Point machine cannot start a card payment, and the sale stays consistent", async () => {
    const a = await makeOrg("A");
    const store = await seedStore(a);
    await seedSellable(a, store.marketId, { barcode: "7891000100103", priceCents: 500 });
    await connect(a);
    const sale = await withOrg(a, (tx) => addItemByBarcode(tx, a, store, { barcode: "7891000100103" }, NOW));
    const { f } = fakeFetch(() => ({ json: {} }));
    const err = await withOrg(a, async (tx) =>
      startPayment(tx, a, store, sale.id, await resolvePix(tx, f), NOW, { method: "card", card: await resolveCard(tx, f) }),
    ).catch((e) => e);
    expect(err).toMatchObject({ code: "provider_unavailable" });
    const [s] = await adminSql`select status from sales where id = ${sale.id}`;
    expect(s.status).toBe("open");
    expect(await adminSql`select 1 from payments`).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/payments/registry-org.test.ts`
Expected: FAIL (`resolvePix` não existe).

- [ ] **Step 3: Reescrever `src/payments/registry.ts`**

```ts
import type { Tx } from "@/db/tenant";
import { readOwnMercadoPagoCredentials } from "@/domain/credentials";
import { AppError } from "@/lib/errors";
import type { CardProvider } from "./card";
import { fakeProvider } from "./fake";
import { fakeCardProvider } from "./fake-card";
import type { Fetch } from "./mercadopago-http";
import { mercadoPagoPoint } from "./mercadopago-card";
import { mercadoPagoPix } from "./mercadopago-pix";
import type { PaymentProvider } from "./provider";

// By-name registries serve the dev routes and the old webhook URLs: only the simulator is in them.
const PROVIDERS: Record<string, PaymentProvider> = { fake: fakeProvider };
const CARD_PROVIDERS: Record<string, CardProvider> = { fake: fakeCardProvider };

export function getProvider(name: string = "fake"): PaymentProvider {
  // hasOwn: the name comes from a URL, so "constructor" must not resolve to Object.prototype members.
  if (!Object.hasOwn(PROVIDERS, name)) throw new Error(`Unknown Pix provider: ${name}`);
  return PROVIDERS[name];
}

export function getCardProvider(name: string = "fake"): CardProvider {
  if (!Object.hasOwn(CARD_PROVIDERS, name)) throw new Error(`Unknown card provider: ${name}`);
  return CARD_PROVIDERS[name];
}

/** The organization of the transaction (RLS). Failing to read or decrypt is "provider unavailable". */
async function credentialsOf(tx: Tx) {
  try {
    return await readOwnMercadoPagoCredentials(tx);
  } catch {
    throw new AppError("provider_unavailable");
  }
}

/**
 * Pix provider of the organization: Mercado Pago when it connected an account, else the simulator
 * (which refuses to run in production, so a production organization without credentials gets provider_unavailable).
 */
export async function resolvePix(tx: Tx, f?: Fetch): Promise<PaymentProvider> {
  const creds = await credentialsOf(tx);
  return creds ? mercadoPagoPix(creds, f) : getProvider("fake");
}

/** Card provider of the organization; the Point machine comes from the totem's own row. */
export async function resolveCard(tx: Tx, f?: Fetch): Promise<CardProvider> {
  const creds = await credentialsOf(tx);
  if (!creds) return getCardProvider("fake");
  return mercadoPagoPoint(
    creds,
    async (terminalId) => {
      const [t] = await tx`select point_device_id from terminals where id = ${terminalId}`;
      return (t?.point_device_id as string | null) ?? null;
    },
    f,
  );
}
```

- [ ] **Step 4: Ligar `src/domain/payments.ts`**

Trocar o import `import { getCardProvider } from "@/payments/registry";` por `import { resolveCard } from "@/payments/registry";`.

Substituir a função `cardProviderOrThrow` por:

```ts
async function cardProviderOrThrow(tx: Tx, card?: CardProvider): Promise<CardProvider> {
  if (card) return card;
  try {
    return await resolveCard(tx);
  } catch {
    throw new AppError("provider_unavailable");
  }
}
```

Em `endPending`, trocar `const provider = cardProviderOrThrow(card);` por `const provider = await cardProviderOrThrow(tx, card);`.
Em `startPayment`, trocar `const card = cardProviderOrThrow(opts.card);` por `const card = await cardProviderOrThrow(tx, opts.card);`.
Em `confirmPayment`, no laço `for (const e of ended)`, trocar `await withTimeout(getCardProvider().cancelCardCharge(e.external_id as string));` por `await withTimeout((await resolveCard(tx)).cancelCardCharge(e.external_id as string));` (continua dentro do `try` existente).

- [ ] **Step 5: Ligar `src/domain/refresh.ts`**

Trocar o import de `getCardProvider` de `@/payments/registry` por `resolveCard` (mesma linha de import) e a linha `source = card ?? getCardProvider();` por `source = card ?? (await resolveCard(tx));` (já está dentro do `try`).

- [ ] **Step 6: Ligar `src/pdv/http.ts`**

Trocar o import de `getProvider` por `resolvePix` (de `@/payments/registry`) e os dois usos:

```ts
    return withOrg(t.orgId, async (tx) =>
      startPayment(tx, t.orgId, ctx(t), saleId, await resolvePix(tx), now, { method }),
    );
```

e

```ts
  handle(req, (t) =>
    withOrg(t.orgId, async (tx) => refreshSale(tx, ctx(t), saleId, await resolvePix(tx), now)),
  );
```

- [ ] **Step 7: Ligar `src/payments/reconcile.ts`**

Trocar o import para `import { resolvePix } from "./registry";`, remover a linha `const provider = getProvider();`, trocar o comentário `ponytail` do cabeçalho por `Each sale uses the provider of its own organization.` e a chamada por:

```ts
      await withOrg(r.org_id as string, async (tx) =>
        refreshSale(
          tx,
          { terminalId: r.terminal_id as string, marketId: r.market_id as string },
          r.id as string,
          await resolvePix(tx),
          now,
        ),
      );
```

- [ ] **Step 8: Remover as variáveis de provedor global**

Em `vitest.config.ts` apagar as linhas `PIX_PROVIDER: "fake",` e `CARD_PROVIDER: "fake",`. Em `.env.example` apagar as linhas `PIX_PROVIDER=fake` e `CARD_PROVIDER=fake`.

- [ ] **Step 9: Rodar o teste novo, os tipos e a suíte inteira**

Run: `npx vitest run tests/payments/registry-org.test.ts && npx tsc --noEmit && npm test`
Expected: tudo PASS (o teste novo mais os 576 existentes; os testes antigos injetam provedores ou caem no `fake`). Se algum teste antigo falhar por causa de `PIX_PROVIDER` ou `CARD_PROVIDER`, ajuste só o teste para usar o nome `"fake"`.

- [ ] **Step 10: Commit**

```bash
git add src vitest.config.ts .env.example tests/payments/registry-org.test.ts
git commit -m "feat: resolve payment providers per organization" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Webhook Mercado Pago por organização

**Files:**
- Modify: `src/payments/webhook.ts`
- Create: `src/app/api/webhooks/pix/mercadopago/[orgId]/route.ts`, `src/app/api/webhooks/card/mercadopago/[orgId]/route.ts`
- Test: `tests/payments/mercadopago-webhook.test.ts`

**Interfaces:**
- Consumes: `readMercadoPagoCredentials` (Tarefa 2), `verifyNotification`, `Fetch` (Tarefa 3), `mercadoPagoPix`, `mercadoPagoPoint`, `confirmPayment`, `failPayment`, `withTimeout`.
- Produces: `handleMercadoPagoWebhook(kind: "pix" | "card", orgId: string, url: URL, headers: Headers, rawBody: string, now?: Date, f?: Fetch): Promise<Outcome>` com os resultados: 404 `unknown_provider`, 401 `invalid_webhook`, 200 `ignored`, 200 `unknown_payment`, 200 `confirmed` / `already_confirmed` / `rejected` / `failed`, 503 `provider_unavailable`.

- [ ] **Step 1: Escrever o teste**

`tests/payments/mercadopago-webhook.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { adminSql } from "@/db/client";
import { withOrg } from "@/db/tenant";
import { saveMercadoPagoCredentials } from "@/domain/credentials";
import { startPayment } from "@/domain/payments";
import { addItemByBarcode } from "@/domain/sales";
import { fakeProvider } from "@/payments/fake";
import { fakeCardProvider } from "@/payments/fake-card";
import { handleMercadoPagoWebhook } from "@/payments/webhook";
import { makeOrg, resetDb, seedSellable, seedStore } from "../helpers";
import { fakeFetch, signNotification } from "./mp-fetch";

beforeEach(resetDb);

const NOW = new Date("2026-10-05T12:00:00Z");
const BARCODE = "7891000100103";
const SECRET = "whsec-123456";
const CREDS = { accessToken: "APP_USR-token-1234", webhookSecret: SECRET };
const ts = Math.floor(NOW.getTime() / 1000);

/** A sale awaiting payment whose payment now belongs to Mercado Pago under the given external id. */
async function awaiting(method: "pix" | "card", externalId: string, name = "A") {
  const orgId = await makeOrg(name);
  const store = await seedStore(orgId);
  await seedSellable(orgId, store.marketId, { barcode: BARCODE, priceCents: 500 });
  await withOrg(orgId, (tx) => saveMercadoPagoCredentials(tx, orgId, CREDS));
  const sale = await withOrg(orgId, (tx) => addItemByBarcode(tx, orgId, store, { barcode: BARCODE }, NOW));
  await withOrg(orgId, (tx) =>
    startPayment(tx, orgId, store, sale.id, fakeProvider, NOW, { method, card: fakeCardProvider }),
  );
  await adminSql`update payments set provider = 'mercadopago', external_id = ${externalId} where sale_id = ${sale.id}`;
  return { orgId, saleId: sale.id };
}

const payment = (status: string, amount = 5, detail?: string) => ({
  json: { status, status_detail: detail, transaction_amount: amount },
});
const order = (status: string, amount = "5.00") => ({ json: { status, total_amount: amount } });

const deliver = (
  kind: "pix" | "card",
  orgId: string,
  id: string,
  reply: { status?: number; json?: unknown },
  o: { secret?: string; ts?: number; type?: string; sigId?: string } = {},
) => {
  const { f } = fakeFetch(() => reply);
  const type = o.type ?? (kind === "pix" ? "payment" : "order");
  const rawBody = JSON.stringify({ type, action: `${type}.updated`, data: { id }, lie: { amount: 99999 } });
  const url = new URL(`https://app.example/api/webhooks/${kind}/mercadopago/${orgId}?data.id=${id}&type=${type}`);
  const headers = signNotification(SECRET, { id: o.sigId ?? id, ts: o.ts ?? ts, secretOverride: o.secret });
  return handleMercadoPagoWebhook(kind, orgId, url, headers, rawBody, NOW, f);
};

const saleStatus = async (saleId: string) =>
  (await adminSql`select status from sales where id = ${saleId}`)[0].status as string;
const movements = async (saleId: string) =>
  (await adminSql`select count(*)::int as n from stock_movements where sale_id = ${saleId}`)[0].n as number;

describe("handleMercadoPagoWebhook", () => {
  it("confirms an approved Pix, pays the sale and takes stock out once", async () => {
    const { orgId, saleId } = await awaiting("pix", "9001");
    expect(await deliver("pix", orgId, "9001", payment("approved"))).toEqual({
      status: 200,
      body: { result: "confirmed" },
    });
    expect((await deliver("pix", orgId, "9001", payment("approved"))).body.result).toBe("already_confirmed");
    expect(await saleStatus(saleId)).toBe("paid");
    expect(await movements(saleId)).toBe(1);
  });

  it("takes state and amount from the API, never from the webhook body", async () => {
    const { orgId, saleId } = await awaiting("pix", "9002");
    const r = await deliver("pix", orgId, "9002", payment("approved", 1)); // body lies 99999, API says 1.00 paid
    expect(r.body.result).toBe("rejected");
    expect(await saleStatus(saleId)).not.toBe("paid");
    expect(await movements(saleId)).toBe(0);
  });

  it("confirms an approved card order", async () => {
    const { orgId, saleId } = await awaiting("card", "ORD9003");
    expect((await deliver("card", orgId, "ORD9003", order("processed"))).body.result).toBe("confirmed");
    expect(await saleStatus(saleId)).toBe("paid");
  });

  it("puts the sale back at the cart when the card is declined, and ignores a repeat", async () => {
    const { orgId, saleId } = await awaiting("card", "ORD9004");
    expect(await deliver("card", orgId, "ORD9004", order("failed"))).toEqual({
      status: 200,
      body: { result: "failed" },
    });
    expect(await saleStatus(saleId)).toBe("open");
    expect((await deliver("card", orgId, "ORD9004", order("failed"))).body.result).toBe("ignored");
    const [p] = await adminSql`select status, failure_reason from payments where sale_id = ${saleId}`;
    expect(p).toMatchObject({ status: "failed", failure_reason: "declined" });
  });

  it("maps an expired or cancelled card order to the matching reason", async () => {
    const a = await awaiting("card", "ORD9005");
    await deliver("card", a.orgId, "ORD9005", order("expired"));
    expect((await adminSql`select failure_reason from payments where sale_id = ${a.saleId}`)[0].failure_reason).toBe("expired");
    const b = await awaiting("card", "ORD9006", "B");
    await deliver("card", b.orgId, "ORD9006", order("canceled"));
    expect((await adminSql`select failure_reason from payments where sale_id = ${b.saleId}`)[0].failure_reason).toBe("cancelled");
  });

  it("ignores a Pix that is still pending or failed (the reconciliation reads the same state)", async () => {
    const { orgId, saleId } = await awaiting("pix", "9007");
    expect((await deliver("pix", orgId, "9007", payment("pending"))).body.result).toBe("ignored");
    expect((await deliver("pix", orgId, "9007", payment("rejected"))).body.result).toBe("ignored");
    expect(await saleStatus(saleId)).toBe("awaiting_payment");
  });

  it("a late approval is rejected when the sale total changed meanwhile", async () => {
    const { orgId, saleId } = await awaiting("pix", "9008");
    await adminSql`update sales set total_cents = 700 where id = ${saleId}`;
    expect((await deliver("pix", orgId, "9008", payment("approved"))).body.result).toBe("rejected");
    expect(await saleStatus(saleId)).not.toBe("paid");
  });

  it("answers 404 for an unknown organization, a malformed id or an organization without credentials", async () => {
    const { orgId } = await awaiting("pix", "9009");
    const empty = await makeOrg("Sem credenciais");
    expect((await deliver("pix", "00000000-0000-4000-8000-000000000000", "9009", payment("approved"))).status).toBe(404);
    expect((await deliver("pix", "nao-e-uuid", "9009", payment("approved"))).status).toBe(404);
    expect((await deliver("pix", empty, "9009", payment("approved"))).status).toBe(404);
    expect(orgId).toBeTruthy();
  });

  it("answers 401 for a wrong secret, a stale timestamp or a signature over another id", async () => {
    const { orgId, saleId } = await awaiting("pix", "9010");
    for (const o of [{ secret: "outro-segredo" }, { ts: ts - 3600 }, { sigId: "1234" }]) {
      expect(await deliver("pix", orgId, "9010", payment("approved"), o)).toEqual({
        status: 401,
        body: { result: "invalid_webhook" },
      });
    }
    expect(await saleStatus(saleId)).toBe("awaiting_payment");
  });

  it("never lets the secret of one organization confirm a payment of another", async () => {
    const a = await awaiting("pix", "9011", "A");
    const b = await awaiting("pix", "9111", "B"); // a payment id is unique per provider, so B has its own
    await withOrg(b.orgId, (tx) =>
      saveMercadoPagoCredentials(tx, b.orgId, { accessToken: "APP_USR-token-b-1234", webhookSecret: "segredo-da-org-b" }),
    );
    // Org B's URL signed with org A's secret
    expect((await deliver("pix", b.orgId, "9111", payment("approved"))).status).toBe(401);
    // Org A's URL cannot reach org B's payment id
    expect((await deliver("pix", a.orgId, "9111", payment("approved"))).body.result).toBe("unknown_payment");
    expect((await deliver("pix", a.orgId, "9011", payment("approved"))).body.result).toBe("confirmed");
    expect(await saleStatus(a.saleId)).toBe("paid");
    expect(await saleStatus(b.saleId)).toBe("awaiting_payment");
  });

  it("answers unknown_payment for an id nobody owns and ignores other topics", async () => {
    const { orgId } = await awaiting("pix", "9012");
    expect((await deliver("pix", orgId, "424242", payment("approved"))).body.result).toBe("unknown_payment");
    expect((await deliver("pix", orgId, "9012", payment("approved"), { type: "merchant_order" })).body.result).toBe("ignored");
    // a card notification on the Pix route is not a Pix event
    expect((await deliver("pix", orgId, "9012", payment("approved"), { type: "order" })).body.result).toBe("ignored");
  });

  it("answers 503 so Mercado Pago retries when the API cannot be asked", async () => {
    const { orgId, saleId } = await awaiting("pix", "9013");
    expect(await deliver("pix", orgId, "9013", { status: 500, json: {} })).toEqual({
      status: 503,
      body: { result: "provider_unavailable" },
    });
    expect(await saleStatus(saleId)).toBe("awaiting_payment");
  });

  it("answers 404 when the stored credentials cannot be decrypted", async () => {
    const { orgId } = await awaiting("pix", "9014");
    await adminSql`update provider_credentials set webhook_secret_enc = 'v1:AAAA:AAAA:AAAA'`;
    expect((await deliver("pix", orgId, "9014", payment("approved"))).status).toBe(404);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/payments/mercadopago-webhook.test.ts`
Expected: FAIL (`handleMercadoPagoWebhook` não existe).

- [ ] **Step 3: Implementar em `src/payments/webhook.ts`**

Acrescentar aos imports do topo (mantendo os existentes):

```ts
import { z } from "zod";
import { readMercadoPagoCredentials } from "@/domain/credentials";
import { type Fetch, verifyNotification } from "./mercadopago-http";
import { mercadoPagoPoint } from "./mercadopago-card";
import { mercadoPagoPix } from "./mercadopago-pix";
import { withTimeout } from "./provider";
```

(O arquivo já importa `PaymentProvider` de `./provider`: junte `withTimeout` nessa mesma linha de import em vez de duplicar.)

No fim do arquivo, acrescentar:

```ts
/**
 * Mercado Pago callback, one URL per organization because the signing secret is per organization.
 * The notification only says that an id changed: after the signature is verified, state and amount come
 * from the API, never from the body. 503 makes Mercado Pago retry when the API cannot be asked.
 */
export async function handleMercadoPagoWebhook(
  kind: "pix" | "card",
  orgId: string,
  url: URL,
  headers: Headers,
  rawBody: string,
  now: Date = new Date(),
  f: Fetch = fetch,
): Promise<Outcome> {
  if (!z.string().uuid().safeParse(orgId).success) return { status: 404, body: { result: "unknown_provider" } };
  let creds: Awaited<ReturnType<typeof readMercadoPagoCredentials>>;
  try {
    creds = await readMercadoPagoCredentials(orgId);
  } catch {
    creds = null; // cannot be decrypted: same as not connected
  }
  if (!creds) return { status: 404, body: { result: "unknown_provider" } };

  let n: ReturnType<typeof verifyNotification>;
  try {
    n = verifyNotification(creds.webhookSecret, headers, rawBody, url, now);
  } catch {
    return { status: 401, body: { result: "invalid_webhook" } };
  }
  if (!n || n.kind !== (kind === "pix" ? "payment" : "order")) return { status: 200, body: { result: "ignored" } };

  const [p] = await adminSql`
    select id from payments
    where org_id = ${orgId} and provider = 'mercadopago' and external_id = ${n.id} and method = ${kind}`;
  if (!p) return { status: 200, body: { result: "unknown_payment" } };

  let charge: Awaited<ReturnType<PaymentProvider["getCharge"]>> & { failureReason?: "declined" | "cancelled" };
  try {
    charge =
      kind === "pix"
        ? await withTimeout(mercadoPagoPix(creds, f).getCharge(n.id))
        : await withTimeout(mercadoPagoPoint(creds, async () => null, f).getCharge(n.id));
  } catch {
    return { status: 503, body: { result: "provider_unavailable" } };
  }

  if (charge.status === "confirmed") {
    const result = await withOrg(orgId, (tx) =>
      confirmPayment(tx, p.id as string, charge.amountCents, safeJson(rawBody), now),
    );
    return { status: 200, body: { result } };
  }
  // A Pix that failed or expired is read again by the reconciliation; a card outcome acts at once.
  if (kind === "pix" || charge.status === "pending") return { status: 200, body: { result: "ignored" } };
  const reason = charge.status === "expired" ? "expired" : (charge.failureReason ?? "declined");
  const changed = await withOrg(orgId, (tx) => failPayment(tx, p.id as string, reason, now));
  return { status: 200, body: { result: changed ? "failed" : "ignored" } };
}
```

- [ ] **Step 4: Rotas**

`src/app/api/webhooks/pix/mercadopago/[orgId]/route.ts`:

```ts
import { handleMercadoPagoWebhook } from "@/payments/webhook";

export async function POST(req: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const r = await handleMercadoPagoWebhook("pix", orgId, new URL(req.url), req.headers, await req.text());
  return Response.json(r.body, { status: r.status });
}
```

`src/app/api/webhooks/card/mercadopago/[orgId]/route.ts`: o mesmo conteúdo, com `"card"` no lugar de `"pix"`.

- [ ] **Step 5: Rodar**

Run: `npx vitest run tests/payments/mercadopago-webhook.test.ts && npx tsc --noEmit`
Expected: PASS e sem erros de tipo.

- [ ] **Step 6: Suíte dos webhooks antigos**

Run: `npx vitest run tests/payments tests/pdv`
Expected: PASS (as rotas `/[provider]` continuam funcionando só para o `fake`).

- [ ] **Step 7: Commit**

```bash
git add src/payments/webhook.ts "src/app/api/webhooks/pix/mercadopago" "src/app/api/webhooks/card/mercadopago" tests/payments/mercadopago-webhook.test.ts
git commit -m "feat: per-organization Mercado Pago webhooks that confirm from the API state" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Tela do dono e maquininha do totem

**Files:**
- Modify: `src/auth/permissions.ts`, `src/app/o/[orgId]/layout.tsx`, `src/app/o/[orgId]/terminals/page.tsx`, `src/app/o/[orgId]/terminals/actions.ts`, `src/app/o/[orgId]/terminals/TerminalForm.tsx`
- Create: `src/app/o/[orgId]/settings/payments/page.tsx`, `src/app/o/[orgId]/settings/payments/actions.ts`
- Test: `tests/auth/permissions.test.ts` (ajustar se o teste existente fixa a matriz)

**Interfaces:**
- Consumes: `saveMercadoPagoCredentials`, `mercadoPagoStatus`, `removeMercadoPagoCredentials`, `readOwnMercadoPagoCredentials` (Tarefa 2), `mpCall`, `MercadoPagoError` (Tarefa 3), `setTerminalDevice`, `requireOrg`, `requireOrgPage`, `redirectOnAppError`, `formToObject`.
- Produces: nova ação de permissão `"payment:write"` (só dono); rota `/o/[orgId]/settings/payments`.

- [ ] **Step 1: Permissão**

Em `src/auth/permissions.ts`, na lista do `owner`, trocar a linha `"access:read", "access:write",` por `"access:read", "access:write", "payment:write",`.

Run: `npx vitest run tests/auth/permissions.test.ts tests/auth/access-permissions.test.ts`
Se algum teste fixar a lista completa de ações do dono, acrescente `payment:write` ali; senão, acrescente em `tests/auth/permissions.test.ts` este teste (ajuste os imports ao arquivo):

```ts
import { can } from "@/auth/permissions";
it("only the owner manages payment credentials", () => {
  expect(can("owner", "payment:write")).toBe(true);
  expect(can("manager", "payment:write")).toBe(false);
  expect(can("restocker", "payment:write")).toBe(false);
});
```

Expected: PASS.

- [ ] **Step 2: Actions da tela de pagamentos**

`src/app/o/[orgId]/settings/payments/actions.ts`:

```ts
"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { redirectOnAppError } from "@/app/action-utils";
import { requireOrg } from "@/auth/guard";
import { withOrg } from "@/db/tenant";
import {
  readOwnMercadoPagoCredentials,
  removeMercadoPagoCredentials,
  saveMercadoPagoCredentials,
} from "@/domain/credentials";
import { AppError } from "@/lib/errors";
import { formToObject } from "@/lib/validate";
import { mpCall } from "@/payments/mercadopago-http";
import { withTimeout } from "@/payments/provider";

const pathOf = (orgId: string) => `/o/${orgId}/settings/payments`;

export async function saveCredentialsAction(orgId: string, fd: FormData) {
  try {
    await requireOrg(orgId, "payment:write");
    const raw = formToObject(fd);
    await withOrg(orgId, (tx) => saveMercadoPagoCredentials(tx, orgId, raw));
  } catch (e) {
    redirectOnAppError(e, pathOf(orgId));
  }
  revalidatePath(pathOf(orgId));
  redirect(`${pathOf(orgId)}?ok=saved`);
}

export async function removeCredentialsAction(orgId: string) {
  try {
    await requireOrg(orgId, "payment:write");
    await withOrg(orgId, (tx) => removeMercadoPagoCredentials(tx));
  } catch (e) {
    redirectOnAppError(e, pathOf(orgId));
  }
  revalidatePath(pathOf(orgId));
  redirect(`${pathOf(orgId)}?ok=removed`);
}

/** Asks Mercado Pago who the token belongs to. Nothing of the answer is shown or kept. */
export async function testCredentialsAction(orgId: string) {
  try {
    await requireOrg(orgId, "payment:write");
    const creds = await withOrg(orgId, (tx) => readOwnMercadoPagoCredentials(tx));
    if (!creds) throw new AppError("not_found");
    try {
      await withTimeout(mpCall(creds, fetch, "GET", "/users/me"));
    } catch {
      throw new AppError("credentials_test_failed");
    }
  } catch (e) {
    redirectOnAppError(e, pathOf(orgId));
  }
  redirect(`${pathOf(orgId)}?ok=tested`);
}
```

- [ ] **Step 3: Página**

`src/app/o/[orgId]/settings/payments/page.tsx`:

```tsx
import { headers } from "next/headers";
import { requireOrgPage } from "@/auth/guard";
import { withOrg } from "@/db/tenant";
import { mercadoPagoStatus } from "@/domain/credentials";
import { message } from "@/lib/messages";
import { removeCredentialsAction, saveCredentialsAction, testCredentialsAction } from "./actions";

const OK: Record<string, string> = {
  saved: "Credenciais salvas.",
  removed: "Credenciais removidas. Os pagamentos voltam ao simulador.",
  tested: "O Mercado Pago aceitou o token.",
};

export default async function PaymentsSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string }>;
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const { orgId } = await params;
  const { error, ok } = await searchParams;
  await requireOrgPage(orgId, "payment:write");
  const status = await withOrg(orgId, (tx) => mercadoPagoStatus(tx));
  const h = await headers();
  const base = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
  return (
    <main>
      <h1>Pagamentos (Mercado Pago)</h1>
      {error && <p role="alert">{message(error)}</p>}
      {ok && OK[ok] && <p role="status">{OK[ok]}</p>}
      <p>
        {status.configured
          ? `Conectado. Token terminando em ${status.last4}, atualizado em ${status.updatedAt?.toLocaleString("pt-BR")}.`
          : "Não conectado. Os pagamentos usam o simulador."}
      </p>
      <form action={saveCredentialsAction.bind(null, orgId)}>
        <label>
          Access token <input name="accessToken" type="password" required autoComplete="off" />
        </label>{" "}
        <label>
          Segredo do webhook <input name="webhookSecret" type="password" required autoComplete="off" />
        </label>{" "}
        <button type="submit">{status.configured ? "Trocar credenciais" : "Salvar credenciais"}</button>
      </form>
      {status.configured && (
        <>
          <form action={testCredentialsAction.bind(null, orgId)} style={{ display: "inline" }}>
            <button type="submit">Testar</button>
          </form>{" "}
          <form action={removeCredentialsAction.bind(null, orgId)} style={{ display: "inline" }}>
            <button type="submit">Remover</button>
          </form>
        </>
      )}
      <h2>URLs de webhook</h2>
      <p>No painel do Mercado Pago, cadastre estas URLs (eventos de pagamento no Pix e de order no cartão) e copie o segredo gerado para o campo acima.</p>
      <ul>
        <li>
          Pix: <code>{`${base}/api/webhooks/pix/mercadopago/${orgId}`}</code>
        </li>
        <li>
          Cartão: <code>{`${base}/api/webhooks/card/mercadopago/${orgId}`}</code>
        </li>
      </ul>
    </main>
  );
}
```

- [ ] **Step 4: Link no menu**

Em `src/app/o/[orgId]/layout.tsx`, depois da linha do link de Totens, acrescentar:

```tsx
        {can(role, "payment:write") && <a href={`${base}/settings/payments`}>Pagamentos</a>}{" "}
```

- [ ] **Step 5: ID da maquininha no cadastro e na lista de totens**

Em `src/app/o/[orgId]/terminals/TerminalForm.tsx`, depois do `</label>{" "}` do campo Mercado e antes do botão, acrescentar:

```tsx
        <label>
          ID da maquininha Point (opcional){" "}
          <input name="pointDeviceId" maxLength={64} pattern="[\x21-\x7e]+" title="Sem espaços" />
        </label>{" "}
```

Em `src/app/o/[orgId]/terminals/actions.ts`, importar `setTerminalDevice` junto de `createTerminal, revokeTerminal` e acrescentar no fim:

```ts
export async function setTerminalDeviceAction(orgId: string, terminalId: string, fd: FormData) {
  const path = `/o/${orgId}/terminals`;
  try {
    await requireOrg(orgId, "terminal:write");
    const raw = formToObject(fd);
    await withOrg(orgId, (tx) => setTerminalDevice(tx, terminalId, raw));
  } catch (e) {
    redirectOnAppError(e, path);
  }
  redirect(path);
}
```

Em `src/app/o/[orgId]/terminals/page.tsx`: importar `setTerminalDeviceAction` junto das outras actions; na linha de cabeçalho trocar `<th>PDV</th><th>Ações</th>` por `<th>PDV</th><th>Point</th><th>Ações</th>`; depois da célula `<td>{t.pdvStatus ...}</td>` acrescentar:

```tsx
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
```

e trocar `<td colSpan={7}>` por `<td colSpan={8}>`.

- [ ] **Step 6: Verificar tipos, suíte e build**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: tudo passa e o build lista a rota `/o/[orgId]/settings/payments`.

- [ ] **Step 7: Commit**

```bash
git add src
git commit -m "feat: owner screen for Mercado Pago credentials and Point machine per totem" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Documentação, spec e verificação final

**Files:**
- Modify: `README.md`, `docs/superpowers/specs/2026-10-05-fase-7-mercadopago-design.md`

- [ ] **Step 1: README**

Abra `README.md` e faça estas trocas:

1. Na linha 42 (passo 5 das variáveis), trocar `` `PIX_PROVIDER=fake`, `FAKE_PIX_SECRET` `` por `` `FAKE_PIX_SECRET` `` e acrescentar ao fim do item: ` Para o Mercado Pago, defina também `CREDENTIALS_KEY` (`openssl rand -base64 32`): ela cifra, no banco, as credenciais que cada dono cola em **Pagamentos**.`
2. Na linha 83, trocar `(`CARD_PROVIDER=fake`)` por `(simulador, quando a organização não conectou o Mercado Pago)`.
3. Na linha 90, trocar `Variáveis: `CARD_PROVIDER=fake` e `FAKE_CARD_SECRET`` por `Variável: `FAKE_CARD_SECRET``.
4. Acrescentar ao fim do arquivo a seção abaixo.

```markdown
## Mercado Pago (fase 7)

Cada organização usa a própria conta. O dono abre **Pagamentos** no painel e cola o access token e o segredo do webhook de uma aplicação criada em "Suas integrações" do Mercado Pago. Sem credenciais, a organização usa o simulador (que recusa funcionar em produção).

- Pix: `POST /v1/payments`. Cartão: Orders API da Point (`POST /v1/orders`, `type: "point"`). A maquininha de cada totem é o campo **ID da maquininha Point** em **Totens**.
- Webhooks, um par de URLs por organização (a tela mostra as URLs prontas): `POST /api/webhooks/pix/mercadopago/<orgId>` (evento de pagamento) e `POST /api/webhooks/card/mercadopago/<orgId>` (evento de order). A assinatura `x-signature` é validada com o segredo da organização, e o estado do pagamento é sempre consultado na API.
- `CREDENTIALS_KEY` perdida torna as credenciais salvas ilegíveis: o dono precisa colar de novo.

### Roteiro manual (conta de teste e uma Point)

1. Com `CREDENTIALS_KEY` definida e o servidor no ar, entre como dono, abra **Pagamentos**, cole token e segredo e clique em **Testar**: deve mostrar que o Mercado Pago aceitou o token.
2. Cadastre as duas URLs de webhook no painel do Mercado Pago (Pix: pagamentos; cartão: order) e use o segredo gerado.
3. Em **Totens**, preencha o ID da Point do totem.
4. No totem: pagar com Pix, ler o QR no app do banco e pagar: a venda fica paga e o estoque baixa uma vez.
5. Pagar com cartão: a Point mostra o valor; aprovar, recusar (cartão de teste recusado), cancelar pelo botão do totem e deixar expirar. Confira cada desfecho na tela do totem e em **Vendas**.
6. Confira nos logs do servidor que nenhum token, segredo ou corpo de resposta do Mercado Pago aparece.
7. Ponto a confirmar na primeira execução real: o manifesto da assinatura (`id`, `request-id`, `ts`) deve validar nos dois tipos de notificação. Se uma delas voltar 401 com segredo certo, compare o manifesto com a documentação atual e ajuste `verifyNotification`.
```

- [ ] **Step 2: Ajustar o spec às decisões do plano**

Em `docs/superpowers/specs/2026-10-05-fase-7-mercadopago-design.md`:

1. Na seção 4, trocar o item "Cache por organização em `Map` em memória..." por: `- Sem cache: a leitura de credenciais é uma consulta indexada por chamada, o que dispensa invalidação e estado em memória.`
2. Na seção 9, no item **Contrato**, trocar o texto por: `- **Adaptadores:** testes próprios dos adaptadores Mercado Pago com `fetch` injetado e respostas gravadas (criar, consultar, cancelar idempotente, mapeamento de todos os estados, erro sem vazar corpo). A suíte de contrato compartilhada não se aplica porque ela supõe um webhook que já traz o estado; o do Mercado Pago só avisa e o estado vem da API (`parseWebhook` dos adaptadores lança erro e o caminho real é `handleMercadoPagoWebhook`).`
3. Na seção 5 (Pix), acrescentar ao fim: `O Mercado Pago exige expiração mínima de 30 minutos; o adaptador pede 31 minutos, e o pagamento Market77 continua expirando em 3 minutos. Um pagamento tardio só vale se o total da venda não mudou (confirmPayment).`

- [ ] **Step 3: Verificação completa**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: tsc sem erros; todos os testes passam (os 576 anteriores mais os novos desta fase); build gera as rotas novas dos webhooks e da tela de pagamentos.

- [ ] **Step 4: Verificar que nenhum segredo ficou no repositório**

Run: `git grep -nE "APP_USR-[0-9]{6,}|CREDENTIALS_KEY=.+" -- . ':!tests' ':!docs'`
Expected: sem resultados (as chaves e tokens de exemplo só existem em testes e docs).

- [ ] **Step 5: Commit**

```bash
git add README.md docs/superpowers/specs/2026-10-05-fase-7-mercadopago-design.md
git commit -m "docs: document phase 7 Mercado Pago" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Auto-revisão

**Cobertura do spec**
- Seção 3 (credenciais, `point_device_id`, cifra): Tarefas 1 e 2.
- Seção 4 (registro por organização, call sites, env removido): Tarefa 5. O cache foi removido por decisão registrada (Tarefa 8, passo 2).
- Seção 5 (adaptadores Pix e Point, `deviceFor`, expiração mínima, sem `point_device_id`): Tarefas 3, 4 e 5 (teste do totem sem maquininha).
- Seção 6 (webhook por org, assinatura, estado pela API, 404/401/200/503): Tarefa 6.
- Seção 7 (tela do dono, testar, URLs, campo da Point): Tarefa 7.
- Seção 8 (erros, chave ausente): Tarefas 1, 2, 5 e 6.
- Seção 9 (testes): cada tarefa traz os seus; roteiro manual na Tarefa 8.

**Consistência de tipos:** `MercadoPagoCredentials`, `Fetch`, `mpCall`, `verifyNotification`, `mercadoPagoPix(creds, f, clock)`, `mercadoPagoPoint(creds, deviceFor, f, clock)`, `resolvePix(tx, f)`, `resolveCard(tx, f)` e `handleMercadoPagoWebhook(kind, orgId, url, headers, rawBody, now, f)` têm as mesmas assinaturas em todas as tarefas.

**Pontos de atenção para quem executa**
- A chave de teste vem de `vitest.config.ts` (`Buffer.alloc(32, 7)`); testes que tiram a chave usam `vi.stubEnv` e restauram.
- O manifesto exato de `x-signature` para notificações de order é confirmado no primeiro teste real (README, passo 7 do roteiro).
- `PaymentProvider` não tem cancelamento de Pix: um QR do Mercado Pago pago depois da expiração do pagamento Market77 passa por `confirmPayment` (regra do Review Focus 1).
