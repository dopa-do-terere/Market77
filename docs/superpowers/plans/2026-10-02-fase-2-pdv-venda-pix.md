# Fase 2: PDV, venda e Pix - Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Um cliente anônimo escaneia produtos em um totem, paga por Pix (adaptador simulado), o estoque baixa uma única vez na confirmação e o dono acompanha a venda no painel.

**Architecture:** Monólito Next.js sobre o código da fase 1. Uma camada de pagamento atrás de uma interface (`PaymentProvider`) com adaptador `fake`. A venda é uma máquina de estados no domínio (funções que recebem `Tx`). A confirmação vem por webhook (assinado, idempotente) e por reconciliação "preguiçosa" (quando o totem consulta a venda). O totem se identifica por token de dispositivo (hash no banco); o painel ganha totens e vendas. Sem worker, sem fila, sem service worker.

**Tech Stack:** Next.js 15, React 19, TypeScript, Postgres 16, `postgres` (postgres.js), `zod`, `vitest`, `tsx` (todos já instalados) e uma dependência nova: `qrcode` (com `@types/qrcode`).

**Spec:** `docs/superpowers/specs/2026-10-02-fase-2-pdv-venda-pix-design.md` (spec geral: `docs/superpowers/specs/2026-10-01-market77-design.md`)

## Global Constraints

- Stack: Next.js + TypeScript, Postgres com Row Level Security; migrations em SQL puro, sem ORM.
- Toda tabela de negócio tem `org_id` e RLS pela política da fase 1 (`nullif(current_setting('app.org_id', true), '')::uuid`, `USING` e `WITH CHECK`) e FKs compostas `(id, org_id)`. Todo acesso a dados de negócio passa por `withOrg()`. O `adminSql` só descobre a organização no token do totem, no webhook e na varredura de reconciliação.
- Valores monetários são inteiros em centavos. Interface em português do Brasil. Nenhum emoji em código, commits ou arquivos.
- Estoque só muda por `stock_movements` (append-only para o papel da aplicação: só `SELECT` e `INSERT`). A baixa ocorre na confirmação do pagamento, nunca ao adicionar ao carrinho. Saldo negativo é permitido; pagamento confirmado nunca é bloqueado por estoque.
- Limites: quantidade por item de 1 a 99; total da venda até R$ 10.000,00 (1.000.000 centavos); validade do QR 3 minutos; inatividade do carrinho 5 minutos; consulta ao provedor no máximo a cada 10 segundos por pagamento. Todos os inteiros que chegam do cliente têm teto (o `integer` do Postgres estoura em 2147483647).
- Ids vindos de URL, corpo ou argumentos de action nunca podem causar 500: id fora do formato UUID vira 404 (rotas e domínio) ou `invalid_input`.
- Cliente final anônimo: não existe login de cliente. O totem usa `Authorization: Bearer <token>`; o token em claro aparece uma vez, só o SHA-256 é guardado.
- O adaptador `fake` recusa funcionar com `NODE_ENV=production`. Nenhuma credencial real no repositório; apenas segredos de desenvolvimento no `.env.example`.
- Fora desta fase: cartão e maquininha, NFC-e, lote/validade/FEFO, agente do totem, heartbeat, comandos remotos, devolução e estorno, relatórios, venda offline, `provider_credentials`, service worker.

## Review Focus

1. Webhook duplicado ou simultâneo: 20 entregas do mesmo pagamento resultam em um único conjunto de movimentos e saldo exato (Tarefas 6 e 7).
2. Valor pago diferente do cobrado, e segundo pagamento para uma venda já paga: não viram venda paga nem baixam estoque duas vezes; ficam `failed` e visíveis ao dono (Tarefas 6 e 10).
3. Pagamento tardio (QR vencido, carrinho de volta a `open` ou `expired`): ainda confirma; para venda `cancelled` é rejeitado e fica visível (Tarefa 6).
4. Totem revogado, token de outra organização, venda de outro totem, ids malformados e corpo JSON quebrado: sempre 4xx, nunca 500 (Tarefas 3, 5 e 8).
5. Dois escaneamentos simultâneos na mesma venda, centésimo escaneamento do mesmo produto, preço máximo vezes quantidade estourando o total: quantidade exata, `quantity_limit` e `sale_too_large` sem deixar venda órfã (Tarefa 5).
6. Provedor Pix fora do ar: `provider_unavailable` ao iniciar o pagamento; ao reconciliar, a venda não trava nem derruba a leitura (Tarefas 6 e 7).

---

## Estrutura de arquivos

```
src/db/migrations/0002_pdv_sales.sql        # terminals, sales, sale_items, payments, stock_movements.sale_id
src/auth/permissions.ts                     # + terminal:write, sale:read
src/lib/messages.ts                         # + mensagens novas
src/domain/terminals.ts                     # createTerminal, listTerminals, revokeTerminal, hashTerminalToken
src/pdv/auth.ts                             # requireTerminal (adminSql, token do totem)
src/payments/provider.ts                    # interface PaymentProvider
src/payments/fake.ts                        # adaptador simulado + buildFakeWebhook
src/payments/registry.ts                    # getProvider(name)
src/payments/webhook.ts                     # handleProviderWebhook
src/payments/reconcile.ts                   # reconcilePending (varredura entre tenants)
src/domain/sales.ts                         # carrinho: lockSale, addItemByBarcode, setItemQuantity, cancelSale, getSaleView
src/domain/payments.ts                      # startPayment, confirmPayment
src/domain/refresh.ts                       # refreshSale (expiração e reconciliação preguiçosa)
src/domain/sale-queries.ts                  # listRecentSales, getSaleDetail, salesToday (painel)
src/lib/labels.ts                           # rótulos pt-BR de status
src/pdv/http.ts                             # errorResponse, handlers das rotas do totem
src/pdv/scanner.ts                          # buffer do leitor de código de barras
src/app/api/pdv/**/route.ts                 # rotas do totem
src/app/api/webhooks/pix/[provider]/route.ts
src/app/api/dev/fake-pix/[externalId]/pay/route.ts
src/app/api/internal/reconcile/route.ts
src/app/pdv/page.tsx, src/app/pdv/PdvApp.tsx, src/app/manifest.ts
src/app/o/[orgId]/terminals/..., sales/...  # painel
tests/...                                   # espelha src/
```

---

### Task 1: Migration 0002 e helpers de teste

**Files:**
- Create: `src/db/migrations/0002_pdv_sales.sql`
- Modify: `tests/helpers.ts`
- Test: `tests/db/pdv-rls.test.ts`

**Interfaces:**
- Consumes: `adminSql`, `withOrg`, `makeOrg`, `resetDb`, `seedMarketProduct` (fases 1).
- Produces (de `tests/helpers`): `seedStore(orgId): Promise<{ marketId; terminalId }>` (mercado e totem), `seedSellable(orgId, marketId, opts?: { barcode?; priceCents?; name?; active? }): Promise<{ productId; marketProductId }>`, `seedSale(orgId): Promise<{ marketId; terminalId; saleId }>`, `seedPayment(orgId, saleId, opts?: { externalId?; status?; provider?; amountCents? }): Promise<string>`, `codeOf(p: Promise<unknown>): Promise<string | undefined>` (código do `AppError` lançado). Tabelas `terminals`, `sales`, `sale_items`, `payments` no `resetDb`.

- [ ] **Step 1: Atualizar `tests/helpers.ts`**

Acrescentar `import { randomUUID } from "node:crypto";` e `import { AppError } from "@/lib/errors";` junto aos imports existentes. Substituir a constante `TABLES` por:

```ts
const TABLES = [
  "payments", "sale_items", "sales", "terminals",
  "stock_movements", "market_products", "product_barcodes", "products",
  "markets", "memberships", "sessions", "users", "organizations",
];
```

Acrescentar ao final do arquivo:

```ts
export async function seedStore(orgId: string) {
  return withOrg(orgId, async (tx) => {
    const [m] = await tx`insert into markets (org_id, name) values (${orgId}, 'Loja') returning id`;
    const [t] = await tx`
      insert into terminals (org_id, market_id, name, token_hash)
      values (${orgId}, ${m.id}, 'Totem', ${randomUUID()}) returning id`;
    return { marketId: m.id as string, terminalId: t.id as string };
  });
}

export async function seedSellable(
  orgId: string,
  marketId: string,
  o: { barcode?: string; priceCents?: number; name?: string; active?: boolean } = {},
) {
  return withOrg(orgId, async (tx) => {
    const [p] = await tx`insert into products (org_id, name) values (${orgId}, ${o.name ?? "Água"}) returning id`;
    if (o.barcode) {
      await tx`insert into product_barcodes (org_id, product_id, code) values (${orgId}, ${p.id}, ${o.barcode})`;
    }
    const [mp] = await tx`
      insert into market_products (org_id, market_id, product_id, price_cents, active)
      values (${orgId}, ${marketId}, ${p.id}, ${o.priceCents ?? 500}, ${o.active ?? true}) returning id`;
    return { productId: p.id as string, marketProductId: mp.id as string };
  });
}

export async function seedSale(orgId: string) {
  const store = await seedStore(orgId);
  const saleId = await withOrg(orgId, async (tx) => {
    const [s] = await tx`
      insert into sales (org_id, market_id, terminal_id, expires_at)
      values (${orgId}, ${store.marketId}, ${store.terminalId}, now() + interval '5 minutes') returning id`;
    return s.id as string;
  });
  return { ...store, saleId };
}

export async function seedPayment(
  orgId: string,
  saleId: string,
  o: { externalId?: string; status?: string; provider?: string; amountCents?: number } = {},
) {
  return withOrg(orgId, async (tx) => {
    const [p] = await tx`
      insert into payments (org_id, sale_id, provider, external_id, status, amount_cents, qr_payload, expires_at)
      values (${orgId}, ${saleId}, ${o.provider ?? "fake"}, ${o.externalId ?? randomUUID()},
        ${o.status ?? "pending"}, ${o.amountCents ?? 1000}, 'qr', now() + interval '3 minutes')
      returning id`;
    return p.id as string;
  });
}

export async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (e) {
    return e instanceof AppError ? e.code : "not-app-error";
  }
}
```

- [ ] **Step 2: Escrever `tests/db/pdv-rls.test.ts`**

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { withOrg } from "@/db/tenant";
import { makeOrg, resetDb, seedPayment, seedSale, seedSellable, seedStore } from "../helpers";

beforeEach(resetDb);

describe("phase 2 schema", () => {
  it("isolates terminals, sales and payments per tenant", async () => {
    const a = await makeOrg("A");
    const b = await makeOrg("B");
    const sa = await seedSale(a);
    const sb = await seedSale(b);
    await seedPayment(a, sa.saleId);
    await seedPayment(b, sb.saleId);
    const seen = await withOrg(a, async (tx) => ({
      terminals: await tx`select id from terminals`,
      sales: await tx`select id from sales`,
      payments: await tx`select id from payments`,
    }));
    expect([seen.terminals.length, seen.sales.length, seen.payments.length]).toEqual([1, 1, 1]);
  });

  it("blocks a sale that points at another tenant's terminal", async () => {
    const a = await makeOrg("A");
    const b = await makeOrg("B");
    const mine = await seedStore(a);
    const theirs = await seedStore(b);
    await expect(
      withOrg(a, (tx) => tx`
        insert into sales (org_id, market_id, terminal_id, expires_at)
        values (${a}, ${mine.marketId}, ${theirs.terminalId}, now())`),
    ).rejects.toThrow(/foreign key/);
  });

  it("blocks a sale item that points at another tenant's market product", async () => {
    const a = await makeOrg("A");
    const b = await makeOrg("B");
    const sale = await seedSale(a);
    const theirs = await seedStore(b);
    const sellable = await seedSellable(b, theirs.marketId);
    await expect(
      withOrg(a, (tx) => tx`
        insert into sale_items (org_id, sale_id, market_product_id, product_name, quantity, unit_price_cents)
        values (${a}, ${sale.saleId}, ${sellable.marketProductId}, 'x', 1, 100)`),
    ).rejects.toThrow(/foreign key/);
  });

  it("rejects the same provider charge twice, even across tenants", async () => {
    const a = await makeOrg("A");
    const b = await makeOrg("B");
    const sa = await seedSale(a);
    const sb = await seedSale(b);
    await seedPayment(a, sa.saleId, { externalId: "ext-1" });
    await expect(seedPayment(b, sb.saleId, { externalId: "ext-1" })).rejects.toThrow(/duplicate key/);
  });

  it("allows only one pending payment per sale", async () => {
    const a = await makeOrg("A");
    const { saleId } = await seedSale(a);
    await seedPayment(a, saleId, { status: "expired" });
    await seedPayment(a, saleId, { status: "pending" });
    await expect(seedPayment(a, saleId, { status: "pending" })).rejects.toThrow(/duplicate key/);
  });

  it("blocks a second sale movement for the same sale and product", async () => {
    const a = await makeOrg("A");
    const { saleId, marketId } = await seedSale(a);
    const { marketProductId } = await seedSellable(a, marketId);
    const sale = () =>
      withOrg(a, (tx) => tx`
        insert into stock_movements (org_id, market_product_id, type, quantity, sale_id)
        values (${a}, ${marketProductId}, 'sale', -1, ${saleId})`);
    await sale();
    await expect(sale()).rejects.toThrow(/duplicate key/);
    const manual = () =>
      withOrg(a, (tx) => tx`
        insert into stock_movements (org_id, market_product_id, type, quantity)
        values (${a}, ${marketProductId}, 'sale', -1)`);
    await manual();
    await expect(manual()).resolves.toBeDefined();
  });

  it("caps the sale total at R$ 10.000,00", async () => {
    const a = await makeOrg("A");
    const { saleId } = await seedSale(a);
    await expect(
      withOrg(a, (tx) => tx`update sales set total_cents = 1000001 where id = ${saleId}`),
    ).rejects.toThrow(/check constraint/);
    await expect(
      withOrg(a, (tx) => tx`update sales set total_cents = 1000000 where id = ${saleId}`),
    ).resolves.toBeDefined();
  });

  it("does not let the app role delete sales or terminals", async () => {
    const a = await makeOrg("A");
    await seedSale(a);
    await expect(withOrg(a, (tx) => tx`delete from sales`)).rejects.toThrow(/permission denied/);
    await expect(withOrg(a, (tx) => tx`delete from terminals`)).rejects.toThrow(/permission denied/);
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npm test -- tests/db/pdv-rls.test.ts`
Expected: FAIL (`relation "terminals" does not exist`).

- [ ] **Step 4: Criar `src/db/migrations/0002_pdv_sales.sql`**

```sql
-- Terminals: device identity for the self-service totem. Only the SHA-256 of the token is stored.
CREATE TABLE terminals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  market_id uuid NOT NULL,
  name text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  UNIQUE (id, org_id),
  FOREIGN KEY (market_id, org_id) REFERENCES markets (id, org_id)
);

CREATE TABLE sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  market_id uuid NOT NULL,
  terminal_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'awaiting_payment', 'paid', 'cancelled', 'expired')),
  total_cents integer NOT NULL DEFAULT 0 CHECK (total_cents >= 0 AND total_cents <= 1000000),
  expires_at timestamptz NOT NULL,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, org_id),
  FOREIGN KEY (market_id, org_id) REFERENCES markets (id, org_id),
  FOREIGN KEY (terminal_id, org_id) REFERENCES terminals (id, org_id)
);
CREATE INDEX sales_market_created_idx ON sales (market_id, created_at DESC);
CREATE INDEX sales_awaiting_idx ON sales (status) WHERE status = 'awaiting_payment';

-- Name and price are copied at the moment of the scan. unit_cost_cents stays null until lots exist (phase 5).
CREATE TABLE sale_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  sale_id uuid NOT NULL,
  market_product_id uuid NOT NULL,
  product_name text NOT NULL,
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 99),
  unit_price_cents integer NOT NULL CHECK (unit_price_cents > 0),
  unit_cost_cents integer,
  UNIQUE (sale_id, market_product_id),
  UNIQUE (id, org_id),
  FOREIGN KEY (sale_id, org_id) REFERENCES sales (id, org_id) ON DELETE CASCADE,
  FOREIGN KEY (market_product_id, org_id) REFERENCES market_products (id, org_id)
);

CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  sale_id uuid NOT NULL,
  method text NOT NULL DEFAULT 'pix' CHECK (method IN ('pix')),
  provider text NOT NULL,
  external_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'expired', 'failed')),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  qr_payload text NOT NULL,
  expires_at timestamptz NOT NULL,
  checked_at timestamptz,
  webhook_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, external_id),
  UNIQUE (id, org_id),
  FOREIGN KEY (sale_id, org_id) REFERENCES sales (id, org_id)
);
-- One pending charge per sale at any time.
CREATE UNIQUE INDEX payments_one_pending_idx ON payments (sale_id) WHERE status = 'pending';

-- A sale takes each product out of stock at most once, even if confirmation runs twice.
ALTER TABLE stock_movements ADD COLUMN sale_id uuid;
ALTER TABLE stock_movements
  ADD FOREIGN KEY (sale_id, org_id) REFERENCES sales (id, org_id);
CREATE UNIQUE INDEX stock_movements_sale_item_idx
  ON stock_movements (sale_id, market_product_id) WHERE type = 'sale' AND sale_id IS NOT NULL;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['terminals', 'sales', 'sale_items', 'payments']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON %I
        USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid)
        WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid)$p$, t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON terminals, sales, payments TO market77_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON sale_items TO market77_app;
-- stock_movements keeps SELECT and INSERT only (append-only ledger).
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npm test`
Expected: PASS (todos os testes, incluindo os 8 novos de `pdv-rls.test.ts`).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add phase 2 schema (terminals, sales, payments) and test helpers"
```

---

### Task 2: Permissões e mensagens

**Files:**
- Modify: `src/auth/permissions.ts`, `src/lib/messages.ts`, `tests/auth/permissions.test.ts`
- Test: `tests/lib/messages.test.ts` (novo)

**Interfaces:**
- Produces: `Action` ganha `"terminal:write"` (só dono) e `"sale:read"` (dono e gerente). `message(code)` conhece os códigos: `unauthorized`, `terminal_revoked`, `product_not_found`, `product_inactive`, `sale_not_found`, `sale_not_editable`, `sale_empty`, `sale_too_large`, `quantity_limit`, `provider_unavailable`, `payment_failed`.

- [ ] **Step 1: Escrever os testes**

Acrescentar ao final de `tests/auth/permissions.test.ts` (o import de `can` já existe no topo):

```ts
describe("phase 2 permissions", () => {
  it("lets only the owner manage terminals", () => {
    expect(can("owner", "terminal:write")).toBe(true);
    expect(can("manager", "terminal:write")).toBe(false);
    expect(can("restocker", "terminal:write")).toBe(false);
  });

  it("lets the owner and the manager read sales, not the restocker", () => {
    expect(can("owner", "sale:read")).toBe(true);
    expect(can("manager", "sale:read")).toBe(true);
    expect(can("restocker", "sale:read")).toBe(false);
  });
});
```

`tests/lib/messages.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { message } from "@/lib/messages";

const CODES = [
  "unauthorized", "terminal_revoked", "product_not_found", "product_inactive", "sale_not_found",
  "sale_not_editable", "sale_empty", "sale_too_large", "quantity_limit", "provider_unavailable",
  "payment_failed",
];

describe("phase 2 messages", () => {
  it.each(CODES)("has a Portuguese message for %s", (code) => {
    expect(message(code)).not.toBe("Erro inesperado.");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- tests/auth/permissions.test.ts tests/lib/messages.test.ts`
Expected: FAIL (erros de tipo/asserção: ações desconhecidas, mensagens ausentes).

- [ ] **Step 3: Implementar**

Em `src/auth/permissions.ts`, substituir o objeto `MATRIX` por:

```ts
const MATRIX = {
  owner: [
    "member:write", "market:write", "product:write", "price:write", "stock:move", "stock:read",
    "catalog:read", "terminal:write", "sale:read",
  ],
  manager: ["product:write", "price:write", "stock:move", "stock:read", "catalog:read", "sale:read"],
  restocker: ["stock:move", "stock:read", "catalog:read"],
} as const;
```

Em `src/lib/messages.ts`, acrescentar dentro de `MESSAGES`, depois da linha `forbidden`:

```ts
  unauthorized: "Totem não autorizado.",
  terminal_revoked: "Totem desativado. Procure o responsável.",
  product_not_found: "Produto não cadastrado.",
  product_inactive: "Produto indisponível neste mercado.",
  sale_not_found: "Venda não encontrada.",
  sale_not_editable: "Esta venda não pode mais ser alterada.",
  sale_empty: "Adicione ao menos um produto.",
  sale_too_large: "O valor da compra passou do limite de R$ 10.000,00.",
  quantity_limit: "Quantidade máxima por produto: 99.",
  provider_unavailable: "Pagamento indisponível no momento. Tente novamente.",
  payment_failed: "Pagamento não confirmado.",
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test && npm run typecheck`
Expected: PASS e typecheck sem erros.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add terminal and sale permissions and phase 2 messages"
```

---

### Task 3: Totens (domínio e autenticação por token)

**Files:**
- Create: `src/domain/terminals.ts`, `src/pdv/auth.ts`
- Test: `tests/domain/terminals.test.ts`

**Interfaces:**
- Consumes: `Tx`, `withOrg`, `adminSql`, `parse`, `AppError`, `isForeignKeyViolation`, `isInsufficientPrivilege`, `seedStore`, `codeOf`, `makeOrg`, `resetDb`.
- Produces:
  - `hashTerminalToken(token: string): string`; `createTerminal(tx, orgId, raw): Promise<{ id: string; token: string }>` com `raw = { marketId, name }`; `listTerminals(tx): Promise<TerminalRow[]>`; `revokeTerminal(tx, terminalId): Promise<void>`; `type TerminalRow = { id; marketId; marketName; name; createdAt: Date; revokedAt: Date | null }` (`@/domain/terminals`)
  - `type TerminalAuth = { terminalId: string; orgId: string; marketId: string }`; `requireTerminal(req: Request): Promise<TerminalAuth>` (lança `AppError("unauthorized")` ou `AppError("terminal_revoked")`) (`@/pdv/auth`)

- [ ] **Step 1: Escrever `tests/domain/terminals.test.ts`**

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { adminSql } from "@/db/client";
import { withOrg } from "@/db/tenant";
import { createTerminal, hashTerminalToken, listTerminals, revokeTerminal } from "@/domain/terminals";
import { requireTerminal } from "@/pdv/auth";
import { codeOf, makeOrg, resetDb, seedStore } from "../helpers";

beforeEach(resetDb);

const reqWith = (token?: string) =>
  new Request("http://m77.test/api/pdv/ping", {
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
  });

async function setup() {
  const orgId = await makeOrg("A");
  const { marketId } = await seedStore(orgId);
  const made = await withOrg(orgId, (tx) => createTerminal(tx, orgId, { marketId, name: "Totem 1" }));
  return { orgId, marketId, ...made };
}

describe("terminals", () => {
  it("returns the plain token once and stores only its hash", async () => {
    const { id, token } = await setup();
    expect(token.length).toBeGreaterThanOrEqual(43);
    const [row] = await adminSql`select token_hash from terminals where id = ${id}`;
    expect(row.token_hash).toBe(hashTerminalToken(token));
    expect(row.token_hash).not.toBe(token);
  });

  it("lists terminals with the market name", async () => {
    const { orgId } = await setup();
    const list = await withOrg(orgId, (tx) => listTerminals(tx));
    expect(list.map((t) => [t.name, t.marketName, t.revokedAt])).toEqual([["Totem 1", "Loja", null]]);
  });

  it("rejects short names, malformed market ids and another tenant's market", async () => {
    const a = await makeOrg("A");
    const b = await makeOrg("B");
    const mine = await seedStore(a);
    const theirs = await seedStore(b);
    const make = (marketId: string, name = "Totem") =>
      withOrg(a, (tx) => createTerminal(tx, a, { marketId, name }));
    expect(await codeOf(make(mine.marketId, "x"))).toBe("invalid_input");
    expect(await codeOf(make("not-a-uuid"))).toBe("invalid_input");
    expect(await codeOf(make(theirs.marketId))).toBe("not_found");
  });

  it("revokes a terminal and treats unknown or foreign ids as not_found", async () => {
    const { orgId, id } = await setup();
    await withOrg(orgId, (tx) => revokeTerminal(tx, id));
    const [row] = await adminSql`select revoked_at from terminals where id = ${id}`;
    expect(row.revoked_at).not.toBeNull();
    expect(await codeOf(withOrg(orgId, (tx) => revokeTerminal(tx, "nope")))).toBe("not_found");
    const other = await makeOrg("B");
    expect(await codeOf(withOrg(other, (tx) => revokeTerminal(tx, id)))).toBe("not_found");
  });
});

describe("requireTerminal", () => {
  it("resolves a valid token to the terminal, organization and market", async () => {
    const { orgId, marketId, id, token } = await setup();
    expect(await requireTerminal(reqWith(token))).toEqual({ terminalId: id, orgId, marketId });
  });

  it("rejects a missing header and a garbage token as unauthorized", async () => {
    await setup();
    expect(await codeOf(requireTerminal(reqWith()))).toBe("unauthorized");
    expect(await codeOf(requireTerminal(reqWith("garbage")))).toBe("unauthorized");
    expect(await codeOf(requireTerminal(new Request("http://m77.test", { headers: { authorization: "Basic abc" } })))).toBe("unauthorized");
  });

  it("rejects a revoked token as terminal_revoked", async () => {
    const { orgId, id, token } = await setup();
    await withOrg(orgId, (tx) => revokeTerminal(tx, id));
    expect(await codeOf(requireTerminal(reqWith(token)))).toBe("terminal_revoked");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- tests/domain/terminals.test.ts`
Expected: FAIL (módulos não existem).

- [ ] **Step 3: Implementar `src/domain/terminals.ts`**

```ts
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { Tx } from "@/db/tenant";
import { AppError, isForeignKeyViolation, isInsufficientPrivilege } from "@/lib/errors";
import { parse } from "@/lib/validate";

export const hashTerminalToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

const Input = z.object({ marketId: z.string().uuid(), name: z.string().trim().min(2).max(60) });

export type TerminalRow = {
  id: string;
  marketId: string;
  marketName: string;
  name: string;
  createdAt: Date;
  revokedAt: Date | null;
};

/** The plain token is returned once and never stored: only its SHA-256 is. */
export async function createTerminal(
  tx: Tx,
  orgId: string,
  raw: unknown,
): Promise<{ id: string; token: string }> {
  const i = parse(Input, raw);
  const token = randomBytes(32).toString("base64url");
  try {
    const [row] = await tx`
      insert into terminals (org_id, market_id, name, token_hash)
      values (${orgId}, ${i.marketId}, ${i.name}, ${hashTerminalToken(token)})
      returning id`;
    return { id: row.id as string, token };
  } catch (e) {
    if (isForeignKeyViolation(e) || isInsufficientPrivilege(e)) throw new AppError("not_found");
    throw e;
  }
}

export async function listTerminals(tx: Tx): Promise<TerminalRow[]> {
  const rows = await tx`
    select t.id, t.market_id, m.name as market_name, t.name, t.created_at, t.revoked_at
    from terminals t join markets m on m.id = t.market_id
    order by t.created_at desc`;
  return rows.map((r) => ({
    id: r.id as string,
    marketId: r.market_id as string,
    marketName: r.market_name as string,
    name: r.name as string,
    createdAt: r.created_at as Date,
    revokedAt: (r.revoked_at as Date | null) ?? null,
  }));
}

export async function revokeTerminal(tx: Tx, terminalId: string): Promise<void> {
  if (!z.string().uuid().safeParse(terminalId).success) throw new AppError("not_found");
  const rows = await tx`
    update terminals set revoked_at = coalesce(revoked_at, now()) where id = ${terminalId} returning id`;
  if (rows.length === 0) throw new AppError("not_found");
}
```

- [ ] **Step 4: Implementar `src/pdv/auth.ts`**

```ts
import { adminSql } from "@/db/client";
import { hashTerminalToken } from "@/domain/terminals";
import { AppError } from "@/lib/errors";

export type TerminalAuth = { terminalId: string; orgId: string; marketId: string };

/**
 * Resolves "Authorization: Bearer <token>" to a terminal. This runs before any tenant is known,
 * so it uses adminSql, like the session lookup; everything after it goes through withOrg().
 */
export async function requireTerminal(req: Request): Promise<TerminalAuth> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) throw new AppError("unauthorized");
  const [row] = await adminSql`
    select id, org_id, market_id, revoked_at from terminals where token_hash = ${hashTerminalToken(token)}`;
  if (!row) throw new AppError("unauthorized");
  if (row.revoked_at) throw new AppError("terminal_revoked");
  return { terminalId: row.id as string, orgId: row.org_id as string, marketId: row.market_id as string };
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npm test && npm run typecheck`
Expected: PASS e typecheck sem erros.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add terminals domain and device token auth"
```

---

### Task 4: Camada de pagamento (interface, adaptador simulado, contrato)

**Files:**
- Create: `src/payments/provider.ts`, `src/payments/fake.ts`, `src/payments/registry.ts`
- Modify: `vitest.config.ts`, `.env.example`
- Test: `tests/payments/contract.ts` (suíte compartilhada, não é um teste), `tests/payments/fake.test.ts`

**Interfaces:**
- Produces:
  - `type ChargeStatus = "pending" | "confirmed" | "expired" | "failed"`; `type WebhookEvent = { externalId: string; status: "confirmed" | "expired" | "failed"; amountCents: number }`; `interface PaymentProvider { name: string; createPixCharge(i: { saleId: string; amountCents: number; expiresAt: Date }): Promise<{ externalId: string; qrPayload: string; expiresAt: Date }>; getCharge(externalId: string): Promise<{ status: ChargeStatus; amountCents: number }>; parseWebhook(headers: Headers, rawBody: string): WebhookEvent | null }` (`@/payments/provider`). `parseWebhook` valida a assinatura e lança erro se for inválida.
  - `fakeProvider: PaymentProvider`; `buildFakeWebhook(externalId: string, o?: { status?: "confirmed" | "expired" | "failed"; amountCents?: number }): { headers: Headers; rawBody: string }` (também muda o estado da cobrança simulada) (`@/payments/fake`)
  - `getProvider(name?: string): PaymentProvider` (`@/payments/registry`; padrão `process.env.PIX_PROVIDER ?? "fake"`; lança para nome desconhecido)
  - `paymentProviderContract(name: string, make: () => ProviderHarness)` e `type ProviderHarness` (`tests/payments/contract`)

- [ ] **Step 1: Escrever a suíte de contrato `tests/payments/contract.ts`**

```ts
import { describe, expect, it } from "vitest";
import type { PaymentProvider } from "@/payments/provider";

export type ProviderHarness = {
  provider: PaymentProvider;
  /** Makes the provider settle the charge and returns the signed webhook it would send. */
  settle(externalId: string): { headers: Headers; rawBody: string };
  /** A webhook for the charge whose signature is wrong. */
  forged(externalId: string): { headers: Headers; rawBody: string };
};

/** Every payment adapter must pass this suite (the real one runs it against its sandbox). */
export function paymentProviderContract(name: string, make: () => ProviderHarness) {
  describe(`payment provider contract: ${name}`, () => {
    const expiresAt = new Date("2026-10-02T12:03:00Z");
    const charge = (h: ProviderHarness) =>
      h.provider.createPixCharge({ saleId: "sale-1", amountCents: 1000, expiresAt });

    it("creates a charge with an id and a Pix payload", async () => {
      const c = await charge(make());
      expect(c.externalId).not.toBe("");
      expect(c.qrPayload).not.toBe("");
      expect(c.expiresAt).toEqual(expiresAt);
    });

    it("reports a new charge as pending with the charged amount", async () => {
      const h = make();
      const c = await charge(h);
      expect(await h.provider.getCharge(c.externalId)).toEqual({ status: "pending", amountCents: 1000 });
    });

    it("reports a settled charge as confirmed", async () => {
      const h = make();
      const c = await charge(h);
      h.settle(c.externalId);
      expect((await h.provider.getCharge(c.externalId)).status).toBe("confirmed");
    });

    it("parses a genuine webhook into an event", async () => {
      const h = make();
      const c = await charge(h);
      const { headers, rawBody } = h.settle(c.externalId);
      expect(h.provider.parseWebhook(headers, rawBody)).toEqual({
        externalId: c.externalId,
        status: "confirmed",
        amountCents: 1000,
      });
    });

    it("rejects a webhook with an invalid signature", async () => {
      const h = make();
      const c = await charge(h);
      const { headers, rawBody } = h.forged(c.externalId);
      expect(() => h.provider.parseWebhook(headers, rawBody)).toThrow();
    });

    it("rejects getCharge for an unknown charge", async () => {
      await expect(make().provider.getCharge("does-not-exist")).rejects.toThrow();
    });
  });
}
```

- [ ] **Step 2: Escrever `tests/payments/fake.test.ts`**

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildFakeWebhook, fakeProvider } from "@/payments/fake";
import { getProvider } from "@/payments/registry";
import { paymentProviderContract } from "./contract";

afterEach(() => vi.unstubAllEnvs());

paymentProviderContract("fake", () => ({
  provider: fakeProvider,
  settle: (id) => buildFakeWebhook(id, { status: "confirmed" }),
  forged: (id) => ({
    headers: new Headers({ "x-fake-signature": "00" }),
    rawBody: JSON.stringify({ externalId: id, status: "confirmed", amountCents: 1 }),
  }),
}));

describe("fake provider guards", () => {
  const args = { saleId: "s", amountCents: 100, expiresAt: new Date() };

  it("refuses to run in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(fakeProvider.createPixCharge(args)).rejects.toThrow(/production/);
  });

  it("refuses to run without a webhook secret", async () => {
    vi.stubEnv("FAKE_PIX_SECRET", "");
    await expect(fakeProvider.createPixCharge(args)).rejects.toThrow(/FAKE_PIX_SECRET/);
  });
});

describe("provider registry", () => {
  it("returns the fake provider by default and by name", () => {
    expect(getProvider().name).toBe("fake");
    expect(getProvider("fake")).toBe(fakeProvider);
  });

  it.each(["nope", "constructor", "__proto__", "toString"])("rejects the unknown provider %s", (name) => {
    expect(() => getProvider(name)).toThrow(/Unknown Pix provider/);
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npm test -- tests/payments`
Expected: FAIL (módulos não existem).

- [ ] **Step 4: Implementar `src/payments/provider.ts`**

```ts
export type ChargeStatus = "pending" | "confirmed" | "expired" | "failed";

export type WebhookEvent = {
  externalId: string;
  status: "confirmed" | "expired" | "failed";
  amountCents: number;
};

export interface PaymentProvider {
  name: string;
  createPixCharge(i: {
    saleId: string;
    amountCents: number;
    expiresAt: Date;
  }): Promise<{ externalId: string; qrPayload: string; expiresAt: Date }>;
  getCharge(externalId: string): Promise<{ status: ChargeStatus; amountCents: number }>;
  /** Verifies the signature (throws when invalid). Returns null for events we do not care about. */
  parseWebhook(headers: Headers, rawBody: string): WebhookEvent | null;
}
```

- [ ] **Step 5: Implementar `src/payments/fake.ts`**

```ts
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { ChargeStatus, PaymentProvider } from "./provider";

type Charge = { amountCents: number; status: ChargeStatus };

// ponytail: charge state lives in memory, for dev and tests only. A real adapter asks its provider instead.
const g = globalThis as unknown as { __m77fakePix?: Map<string, Charge> };
const charges = (g.__m77fakePix ??= new Map<string, Charge>());

/** Throws in production or without a secret; returns the webhook secret. */
function guard(): string {
  if (process.env.NODE_ENV === "production") throw new Error("fake Pix provider is disabled in production");
  const secret = process.env.FAKE_PIX_SECRET;
  if (!secret) throw new Error("Missing env var FAKE_PIX_SECRET");
  return secret;
}

const sign = (secret: string, body: string) => createHmac("sha256", secret).update(body).digest("hex");

const Event = z.object({
  externalId: z.string().min(1),
  status: z.enum(["confirmed", "expired", "failed"]),
  amountCents: z.number().int().min(0),
});

export const fakeProvider: PaymentProvider = {
  name: "fake",

  async createPixCharge({ amountCents, expiresAt }) {
    guard();
    const externalId = `fake_${randomUUID()}`;
    charges.set(externalId, { amountCents, status: "pending" });
    return { externalId, qrPayload: `FAKEPIX|${externalId}|${amountCents}`, expiresAt };
  },

  async getCharge(externalId) {
    guard();
    const c = charges.get(externalId);
    if (!c) throw new Error(`unknown fake charge ${externalId}`);
    return { status: c.status, amountCents: c.amountCents };
  },

  parseWebhook(headers, rawBody) {
    const secret = guard();
    const given = Buffer.from(headers.get("x-fake-signature") ?? "", "hex");
    const expected = Buffer.from(sign(secret, rawBody), "hex");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new Error("invalid signature");
    }
    return Event.parse(JSON.parse(rawBody));
  },
};

/**
 * Simulates the provider deciding the outcome of a charge and notifying us.
 * The signed body goes through the real webhook path, so production code is exercised.
 */
export function buildFakeWebhook(
  externalId: string,
  o: { status?: "confirmed" | "expired" | "failed"; amountCents?: number } = {},
): { headers: Headers; rawBody: string } {
  const secret = guard();
  const charge = charges.get(externalId);
  const status = o.status ?? "confirmed";
  if (charge) charge.status = status;
  const rawBody = JSON.stringify({
    externalId,
    status,
    amountCents: o.amountCents ?? charge?.amountCents ?? 0,
  });
  return { headers: new Headers({ "x-fake-signature": sign(secret, rawBody) }), rawBody };
}
```

- [ ] **Step 6: Implementar `src/payments/registry.ts`**

```ts
import { fakeProvider } from "./fake";
import type { PaymentProvider } from "./provider";

const PROVIDERS: Record<string, PaymentProvider> = { fake: fakeProvider };

// ponytail: one global provider chosen by env. Per-organization selection arrives with provider_credentials.
export function getProvider(name: string = process.env.PIX_PROVIDER ?? "fake"): PaymentProvider {
  // hasOwn: the name comes from a URL, so "constructor" must not resolve to Object.prototype members.
  if (!Object.hasOwn(PROVIDERS, name)) throw new Error(`Unknown Pix provider: ${name}`);
  return PROVIDERS[name];
}
```

- [ ] **Step 7: Variáveis de ambiente**

Em `vitest.config.ts`, trocar o objeto `env` por:

```ts
const env = {
  DATABASE_URL: "postgres://market77:market77@localhost:5432/market77_test",
  DATABASE_APP_URL: "postgres://market77_app:market77_app@localhost:5432/market77_test",
  PIX_PROVIDER: "fake",
  FAKE_PIX_SECRET: "test-fake-secret",
  RECONCILE_SECRET: "test-reconcile-secret",
};
```

Acrescentar ao final de `.env.example`:

```
PIX_PROVIDER=fake
FAKE_PIX_SECRET=dev-fake-secret
RECONCILE_SECRET=dev-reconcile-secret
```

(O `.env` local do desenvolvedor deve receber as mesmas três linhas; ele não é versionado.)

- [ ] **Step 8: Rodar e ver passar**

Run: `npm test && npm run typecheck`
Expected: PASS e typecheck sem erros.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: add payment provider interface, fake Pix adapter and contract suite"
```

---

### Task 5: Carrinho (domínio de vendas)

**Files:**
- Create: `src/domain/sales.ts`
- Test: `tests/domain/sales.test.ts`

**Interfaces:**
- Consumes: `Tx`, `withOrg`, `parse`, `AppError`, `seedStore`, `seedSellable`, `setMarketProduct`, `codeOf`.
- Produces (`@/domain/sales`):
  - constantes `CART_TTL_MS = 5 * 60_000`, `MAX_QUANTITY = 99`, `MAX_TOTAL_CENTS = 1_000_000`
  - tipos `SaleStatus`, `TerminalCtx = { terminalId: string; marketId: string }`, `SaleItemView = { id; marketProductId; productName; quantity; unitPriceCents }`, `PaymentView = { id; status: "pending" | "confirmed" | "expired" | "failed"; amountCents; qrPayload; expiresAt: Date }`, `SaleView = { id; status: SaleStatus; totalCents; expiresAt: Date; items: SaleItemView[]; payment: PaymentView | null }`, `LockedSale = { id; status: SaleStatus; expiresAt: Date }`
  - `lockSale(tx, term, saleId, now): Promise<LockedSale>`: valida UUID, trava a linha (`for update`), expira carrinho abandonado; `sale_not_found` para id malformado, venda de outro totem ou de outro tenant
  - `getSaleView(tx, saleId): Promise<SaleView>`
  - `addItemByBarcode(tx, orgId, term, raw: { saleId?: string; barcode: string }, now): Promise<SaleView>`
  - `setItemQuantity(tx, term, saleId, raw: { itemId: string; quantity: number }, now): Promise<SaleView>` (quantidade 0 remove o item)
  - `cancelSale(tx, term, saleId, now): Promise<SaleView>`

- [ ] **Step 1: Escrever `tests/domain/sales.test.ts`**

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { adminSql } from "@/db/client";
import { withOrg } from "@/db/tenant";
import { setMarketProduct } from "@/domain/market-products";
import { addItemByBarcode, cancelSale, getSaleView, setItemQuantity } from "@/domain/sales";
import { codeOf, makeOrg, resetDb, seedSellable, seedStore } from "../helpers";

beforeEach(resetDb);

const NOW = new Date("2026-10-02T12:00:00Z");
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);
const BARCODE = "7891000100103";

async function setup(priceCents = 500) {
  const orgId = await makeOrg("A");
  const store = await seedStore(orgId);
  const item = await seedSellable(orgId, store.marketId, { barcode: BARCODE, priceCents });
  const scan = (barcode = BARCODE, saleId?: string, now = NOW) =>
    withOrg(orgId, (tx) => addItemByBarcode(tx, orgId, store, { saleId, barcode }, now));
  return { orgId, store, item, scan };
}

const salesCount = async () => (await adminSql`select count(*)::int as n from sales`)[0].n as number;

describe("cart", () => {
  it("creates the sale on the first scan and counts repeated scans", async () => {
    const { scan } = await setup();
    const first = await scan();
    expect([first.status, first.totalCents, first.items.map((i) => i.quantity)]).toEqual(["open", 500, [1]]);
    const second = await scan(BARCODE, first.id);
    expect([second.id, second.totalCents, second.items[0].quantity]).toEqual([first.id, 1000, 2]);
    expect(second.expiresAt).toEqual(minutes(5));
  });

  it("rejects an unknown barcode without leaving an empty sale behind", async () => {
    const { scan } = await setup();
    expect(await codeOf(scan("0000"))).toBe("product_not_found");
    expect(await salesCount()).toBe(0);
  });

  it("rejects an inactive product", async () => {
    const { orgId, store, scan } = await setup();
    await seedSellable(orgId, store.marketId, { barcode: "INATIVO-1", active: false });
    expect(await codeOf(scan("INATIVO-1"))).toBe("product_inactive");
  });

  it("does not sell a product that only exists in another market", async () => {
    const { orgId, scan } = await setup();
    const other = await seedStore(orgId);
    await seedSellable(orgId, other.marketId, { barcode: "OUTRO-1" });
    expect(await codeOf(scan("OUTRO-1"))).toBe("product_not_found");
  });

  it("freezes the unit price at the first scan", async () => {
    const { orgId, store, item, scan } = await setup();
    const first = await scan();
    await withOrg(orgId, (tx) =>
      setMarketProduct(tx, orgId, { marketId: store.marketId, productId: item.productId, priceCents: 900 }),
    );
    const second = await scan(BARCODE, first.id);
    expect([second.items[0].unitPriceCents, second.totalCents]).toEqual([500, 1000]);
    expect((await scan()).totalCents).toBe(900);
  });

  it("renews the inactivity window on each change and expires an abandoned cart", async () => {
    const { scan } = await setup();
    const first = await scan();
    expect((await scan(BARCODE, first.id, minutes(4))).expiresAt).toEqual(minutes(9));
    expect(await codeOf(scan(BARCODE, first.id, minutes(10)))).toBe("sale_not_editable");
  });

  it("changes quantities, removes with zero and rejects out-of-range values", async () => {
    const { orgId, store, scan } = await setup();
    const first = await scan();
    const itemId = first.items[0].id;
    const set = (quantity: number) =>
      withOrg(orgId, (tx) => setItemQuantity(tx, store, first.id, { itemId, quantity }, NOW));
    expect((await set(3)).totalCents).toBe(1500);
    for (const bad of [100, -1, 1.5]) expect(await codeOf(set(bad))).toBe("invalid_input");
    expect((await set(0)).items).toHaveLength(0);
    expect(await codeOf(set(1))).toBe("not_found");
    expect(await codeOf(withOrg(orgId, (tx) => setItemQuantity(tx, store, first.id, { itemId: "x", quantity: 1 }, NOW)))).toBe("not_found");
  });

  it("stops at 99 units of one product", async () => {
    const { orgId, store, scan } = await setup();
    const first = await scan();
    await withOrg(orgId, (tx) =>
      setItemQuantity(tx, store, first.id, { itemId: first.items[0].id, quantity: 99 }, NOW),
    );
    expect(await codeOf(scan(BARCODE, first.id))).toBe("quantity_limit");
  });

  it("refuses a total above R$ 10.000,00 and keeps the previous total", async () => {
    const { orgId, store, scan } = await setup(600000);
    await seedSellable(orgId, store.marketId, { barcode: "CARO-2", priceCents: 600000 });
    const first = await scan();
    expect(await codeOf(scan("CARO-2", first.id))).toBe("sale_too_large");
    expect((await withOrg(orgId, (tx) => getSaleView(tx, first.id))).totalCents).toBe(600000);
  });

  it("refuses a single product above the cap and creates no sale", async () => {
    const { scan } = await setup(1000001);
    expect(await codeOf(scan())).toBe("sale_too_large");
    expect(await salesCount()).toBe(0);
  });

  it("counts exactly when ten scans race on the same sale", async () => {
    const { scan } = await setup();
    const first = await scan();
    await Promise.all(Array.from({ length: 10 }, () => scan(BARCODE, first.id)));
    const view = await scan(BARCODE, first.id);
    expect([view.items[0].quantity, view.totalCents]).toEqual([12, 6000]);
  });
});

describe("sale access", () => {
  it("hides another terminal's sale, another tenant's sale and malformed ids", async () => {
    const { orgId, store, scan } = await setup();
    const first = await scan();
    const otherTerminal = { ...(await seedStore(orgId)) };
    const cancel = (o: string, t: { terminalId: string; marketId: string }, id: string) =>
      withOrg(o, (tx) => cancelSale(tx, t, id, NOW));
    expect(await codeOf(cancel(orgId, otherTerminal, first.id))).toBe("sale_not_found");
    expect(await codeOf(cancel(orgId, store, "nope"))).toBe("sale_not_found");
    const b = await makeOrg("B");
    const theirs = await seedStore(b);
    expect(await codeOf(cancel(b, theirs, first.id))).toBe("sale_not_found");
  });

  it("cancels an open sale once and never after", async () => {
    const { orgId, store, scan } = await setup();
    const first = await scan();
    const cancelled = await withOrg(orgId, (tx) => cancelSale(tx, store, first.id, NOW));
    expect(cancelled.status).toBe("cancelled");
    expect(await codeOf(withOrg(orgId, (tx) => cancelSale(tx, store, first.id, NOW)))).toBe("sale_not_editable");
    expect(await codeOf(scan(BARCODE, first.id))).toBe("sale_not_editable");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- tests/domain/sales.test.ts`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar `src/domain/sales.ts`**

```ts
import { z } from "zod";
import type { Tx } from "@/db/tenant";
import { AppError } from "@/lib/errors";
import { parse } from "@/lib/validate";

export const CART_TTL_MS = 5 * 60_000;
export const MAX_QUANTITY = 99;
export const MAX_TOTAL_CENTS = 1_000_000;

export type SaleStatus = "open" | "awaiting_payment" | "paid" | "cancelled" | "expired";
export type TerminalCtx = { terminalId: string; marketId: string };
export type SaleItemView = {
  id: string;
  marketProductId: string;
  productName: string;
  quantity: number;
  unitPriceCents: number;
};
export type PaymentView = {
  id: string;
  status: "pending" | "confirmed" | "expired" | "failed";
  amountCents: number;
  qrPayload: string;
  expiresAt: Date;
};
export type SaleView = {
  id: string;
  status: SaleStatus;
  totalCents: number;
  expiresAt: Date;
  items: SaleItemView[];
  payment: PaymentView | null;
};
export type LockedSale = { id: string; status: SaleStatus; expiresAt: Date };

const uuid = z.string().uuid();
const plus = (d: Date, ms: number) => new Date(d.getTime() + ms);

/**
 * Locks the sale row (serializes concurrent edits and payment steps) and lazily expires an abandoned cart.
 * A malformed id, another terminal's sale and another tenant's sale all read as sale_not_found.
 * If the caller then throws, the transaction rolls back the expiry write too; the next lock redoes it.
 */
export async function lockSale(tx: Tx, term: TerminalCtx, saleId: string, now: Date): Promise<LockedSale> {
  if (!uuid.safeParse(saleId).success) throw new AppError("sale_not_found");
  const [row] = await tx`
    select id, status, expires_at from sales
    where id = ${saleId} and terminal_id = ${term.terminalId} for update`;
  if (!row) throw new AppError("sale_not_found");
  const expiresAt = row.expires_at as Date;
  if (row.status === "open" && expiresAt < now) {
    await tx`update sales set status = 'expired' where id = ${saleId}`;
    return { id: saleId, status: "expired", expiresAt };
  }
  return { id: saleId, status: row.status as SaleStatus, expiresAt };
}

export async function getSaleView(tx: Tx, saleId: string): Promise<SaleView> {
  const [s] = await tx`select id, status, total_cents, expires_at from sales where id = ${saleId}`;
  if (!s) throw new AppError("sale_not_found");
  const items = await tx`
    select id, market_product_id, product_name, quantity, unit_price_cents
    from sale_items where sale_id = ${saleId} order by product_name, id`;
  const [p] = await tx`
    select id, status, amount_cents, qr_payload, expires_at
    from payments where sale_id = ${saleId} order by created_at desc limit 1`;
  return {
    id: s.id as string,
    status: s.status as SaleStatus,
    totalCents: s.total_cents as number,
    expiresAt: s.expires_at as Date,
    items: items.map((i) => ({
      id: i.id as string,
      marketProductId: i.market_product_id as string,
      productName: i.product_name as string,
      quantity: i.quantity as number,
      unitPriceCents: i.unit_price_cents as number,
    })),
    payment: p
      ? {
          id: p.id as string,
          status: p.status as PaymentView["status"],
          amountCents: p.amount_cents as number,
          qrPayload: p.qr_payload as string,
          expiresAt: p.expires_at as Date,
        }
      : null,
  };
}

/** Recomputes the total from the items, enforces the cap and renews the inactivity window. */
async function recalc(tx: Tx, saleId: string, now: Date): Promise<void> {
  const [t] = await tx`
    select coalesce(sum(quantity::bigint * unit_price_cents), 0)::bigint as total
    from sale_items where sale_id = ${saleId}`;
  const total = Number(t.total);
  if (total > MAX_TOTAL_CENTS) throw new AppError("sale_too_large");
  await tx`update sales set total_cents = ${total}, expires_at = ${plus(now, CART_TTL_MS)} where id = ${saleId}`;
}

const Scan = z.object({ saleId: z.string().optional(), barcode: z.string().trim().min(1).max(64) });

/** Adds one unit of the product with this barcode, creating the sale when saleId is absent. */
export async function addItemByBarcode(
  tx: Tx,
  orgId: string,
  term: TerminalCtx,
  raw: unknown,
  now: Date,
): Promise<SaleView> {
  const i = parse(Scan, raw);
  const [mp] = await tx`
    select mp.id, mp.price_cents, mp.active, p.name
    from product_barcodes b
    join market_products mp on mp.product_id = b.product_id and mp.market_id = ${term.marketId}
    join products p on p.id = b.product_id
    where b.code = ${i.barcode}`;
  if (!mp) throw new AppError("product_not_found");
  if (!mp.active) throw new AppError("product_inactive");

  let saleId: string;
  if (i.saleId) {
    const sale = await lockSale(tx, term, i.saleId, now);
    if (sale.status !== "open") throw new AppError("sale_not_editable");
    saleId = sale.id;
  } else {
    const [s] = await tx`
      insert into sales (org_id, market_id, terminal_id, expires_at)
      values (${orgId}, ${term.marketId}, ${term.terminalId}, ${plus(now, CART_TTL_MS)}) returning id`;
    saleId = s.id as string;
  }

  const [existing] = await tx`
    select quantity from sale_items where sale_id = ${saleId} and market_product_id = ${mp.id}`;
  if (existing && (existing.quantity as number) >= MAX_QUANTITY) throw new AppError("quantity_limit");
  if (existing) {
    await tx`update sale_items set quantity = quantity + 1 where sale_id = ${saleId} and market_product_id = ${mp.id}`;
  } else {
    await tx`
      insert into sale_items (org_id, sale_id, market_product_id, product_name, quantity, unit_price_cents)
      values (${orgId}, ${saleId}, ${mp.id}, ${mp.name}, 1, ${mp.price_cents})`;
  }
  await recalc(tx, saleId, now);
  return getSaleView(tx, saleId);
}

const Qty = z.object({ itemId: z.string(), quantity: z.number().int().min(0).max(MAX_QUANTITY) });

export async function setItemQuantity(
  tx: Tx,
  term: TerminalCtx,
  saleId: string,
  raw: unknown,
  now: Date,
): Promise<SaleView> {
  const i = parse(Qty, raw);
  const sale = await lockSale(tx, term, saleId, now);
  if (sale.status !== "open") throw new AppError("sale_not_editable");
  if (!uuid.safeParse(i.itemId).success) throw new AppError("not_found");
  const rows =
    i.quantity === 0
      ? await tx`delete from sale_items where id = ${i.itemId} and sale_id = ${sale.id} returning id`
      : await tx`update sale_items set quantity = ${i.quantity} where id = ${i.itemId} and sale_id = ${sale.id} returning id`;
  if (rows.length === 0) throw new AppError("not_found");
  await recalc(tx, sale.id, now);
  return getSaleView(tx, sale.id);
}

export async function cancelSale(tx: Tx, term: TerminalCtx, saleId: string, now: Date): Promise<SaleView> {
  const sale = await lockSale(tx, term, saleId, now);
  if (sale.status !== "open") throw new AppError("sale_not_editable");
  await tx`update sales set status = 'cancelled' where id = ${sale.id}`;
  return getSaleView(tx, sale.id);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test && npm run typecheck`
Expected: PASS e typecheck sem erros.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add cart domain (scan, quantities, cancel, expiry, caps)"
```

---

### Task 6: Pagamento (iniciar e confirmar)

**Files:**
- Create: `src/domain/payments.ts`
- Test: `tests/domain/payments.test.ts`

**Interfaces:**
- Consumes: `lockSale`, `getSaleView`, `SaleView`, `TerminalCtx` (Tarefa 5); `PaymentProvider`, `fakeProvider`, `buildFakeWebhook` (Tarefa 4); `addItemByBarcode`; `getBalance` (fase 1).
- Produces (`@/domain/payments`):
  - `QR_TTL_MS = 3 * 60_000`
  - `startPayment(tx, orgId, term, saleId, provider: PaymentProvider, now: Date): Promise<SaleView>`: venda `open` com itens vai a `awaiting_payment` e ganha um pagamento `pending`; se já existe pagamento pendente com QR válido devolve o mesmo; erros `sale_not_editable`, `sale_empty`, `provider_unavailable`
  - `type ConfirmResult = "confirmed" | "already_confirmed" | "rejected"`; `confirmPayment(tx, paymentId, paidAmountCents, event: unknown, now): Promise<ConfirmResult>`: idempotente; `webhook_payload` fica `{ paidAmountCents, event }`

- [ ] **Step 1: Escrever `tests/domain/payments.test.ts`**

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { adminSql } from "@/db/client";
import { withOrg } from "@/db/tenant";
import { confirmPayment, startPayment } from "@/domain/payments";
import { addItemByBarcode, getSaleView, setItemQuantity } from "@/domain/sales";
import { getBalance, recordMovement } from "@/domain/stock";
import { fakeProvider } from "@/payments/fake";
import type { PaymentProvider } from "@/payments/provider";
import { codeOf, makeOrg, resetDb, seedSellable, seedStore } from "../helpers";

beforeEach(resetDb);

const NOW = new Date("2026-10-02T12:00:00Z");
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);
const BARCODE = "7891000100103";

/** An open sale with two units of one R$ 5,00 product (total 1000). */
async function ready() {
  const orgId = await makeOrg("A");
  const store = await seedStore(orgId);
  const item = await seedSellable(orgId, store.marketId, { barcode: BARCODE, priceCents: 500 });
  const first = await withOrg(orgId, (tx) => addItemByBarcode(tx, orgId, store, { barcode: BARCODE }, NOW));
  await withOrg(orgId, (tx) => addItemByBarcode(tx, orgId, store, { saleId: first.id, barcode: BARCODE }, NOW));
  return { orgId, store, item, saleId: first.id };
}
type Ready = Awaited<ReturnType<typeof ready>>;

const pay = (r: Ready, now = NOW, provider: PaymentProvider = fakeProvider) =>
  withOrg(r.orgId, (tx) => startPayment(tx, r.orgId, r.store, r.saleId, provider, now));
const confirm = (r: Ready, paymentId: string, amount = 1000, now = NOW) =>
  withOrg(r.orgId, (tx) => confirmPayment(tx, paymentId, amount, { test: true }, now));
const payments = async (r: Ready) =>
  adminSql`select id, status, external_id from payments where sale_id = ${r.saleId} order by created_at, id`;
const saleStatus = async (r: Ready) =>
  (await adminSql`select status from sales where id = ${r.saleId}`)[0].status as string;
const movements = async (r: Ready) =>
  (await adminSql`select count(*)::int as n from stock_movements where sale_id = ${r.saleId}`)[0].n as number;
const balance = (r: Ready) => withOrg(r.orgId, (tx) => getBalance(tx, r.item.marketProductId));

describe("startPayment", () => {
  it("creates a pending payment for the frozen total and moves the sale to awaiting_payment", async () => {
    const r = await ready();
    const view = await pay(r);
    expect(view.status).toBe("awaiting_payment");
    expect([view.payment?.status, view.payment?.amountCents]).toEqual(["pending", 1000]);
    expect(view.payment?.qrPayload).toMatch(/^FAKEPIX\|/);
    expect(view.payment?.expiresAt).toEqual(minutes(3));
  });

  it("returns the same QR when called again while it is still valid", async () => {
    const r = await ready();
    const a = await pay(r);
    const b = await pay(r, minutes(1));
    expect(b.payment?.qrPayload).toBe(a.payment?.qrPayload);
    expect(await payments(r)).toHaveLength(1);
  });

  it("issues a new QR after the old one expired and marks the old payment expired", async () => {
    const r = await ready();
    const a = await pay(r);
    const b = await pay(r, minutes(4));
    expect(b.payment?.qrPayload).not.toBe(a.payment?.qrPayload);
    expect((await payments(r)).map((p) => p.status)).toEqual(["expired", "pending"]);
  });

  it("rejects an empty sale", async () => {
    const r = await ready();
    const view = await withOrg(r.orgId, (tx) => getSaleView(tx, r.saleId));
    await withOrg(r.orgId, (tx) =>
      setItemQuantity(tx, r.store, r.saleId, { itemId: view.items[0].id, quantity: 0 }, NOW),
    );
    expect(await codeOf(pay(r))).toBe("sale_empty");
  });

  it("locks the cart while awaiting payment and refuses to pay a paid sale again", async () => {
    const r = await ready();
    await pay(r);
    const scan = () =>
      withOrg(r.orgId, (tx) => addItemByBarcode(tx, r.orgId, r.store, { saleId: r.saleId, barcode: BARCODE }, NOW));
    expect(await codeOf(scan())).toBe("sale_not_editable");
    const [p] = await payments(r);
    await confirm(r, p.id as string);
    expect(await codeOf(pay(r))).toBe("sale_not_editable");
  });

  it("maps a provider failure to provider_unavailable and leaves the sale open", async () => {
    const r = await ready();
    const broken: PaymentProvider = {
      ...fakeProvider,
      createPixCharge: async () => {
        throw new Error("provider down");
      },
    };
    expect(await codeOf(pay(r, NOW, broken))).toBe("provider_unavailable");
    expect(await saleStatus(r)).toBe("open");
    expect(await payments(r)).toHaveLength(0);
  });
});

describe("confirmPayment", () => {
  it("marks the sale paid and takes each item out of stock, allowing a negative balance", async () => {
    const r = await ready();
    await pay(r);
    const [p] = await payments(r);
    expect(await confirm(r, p.id as string)).toBe("confirmed");
    expect(await saleStatus(r)).toBe("paid");
    expect(await movements(r)).toBe(1);
    expect(await balance(r)).toBe(-2);
    const [paid] = await adminSql`select paid_at from sales where id = ${r.saleId}`;
    expect(paid.paid_at).toEqual(NOW);
  });

  it("subtracts from existing stock", async () => {
    const r = await ready();
    await withOrg(r.orgId, (tx) =>
      recordMovement(tx, r.orgId, null, { marketProductId: r.item.marketProductId, type: "in", quantity: 10 }),
    );
    await pay(r);
    const [p] = await payments(r);
    await confirm(r, p.id as string);
    expect(await balance(r)).toBe(8);
  });

  it("is idempotent: confirming twice moves stock once", async () => {
    const r = await ready();
    await pay(r);
    const [p] = await payments(r);
    expect(await confirm(r, p.id as string)).toBe("confirmed");
    expect(await confirm(r, p.id as string)).toBe("already_confirmed");
    expect(await movements(r)).toBe(1);
    expect(await balance(r)).toBe(-2);
  });

  it("confirms exactly once when twenty confirmations race", async () => {
    const r = await ready();
    await pay(r);
    const [p] = await payments(r);
    const results = await Promise.all(Array.from({ length: 20 }, () => confirm(r, p.id as string)));
    expect(results.filter((x) => x === "confirmed")).toHaveLength(1);
    expect(results.filter((x) => x === "already_confirmed")).toHaveLength(19);
    expect(await movements(r)).toBe(1);
    expect(await balance(r)).toBe(-2);
  });

  it.each(["open", "expired"])("still confirms a late payment when the sale went back to %s", async (status) => {
    const r = await ready();
    await pay(r);
    const [p] = await payments(r);
    await adminSql`update payments set status = 'expired' where id = ${p.id}`;
    await adminSql`update sales set status = ${status} where id = ${r.saleId}`;
    expect(await confirm(r, p.id as string)).toBe("confirmed");
    expect(await saleStatus(r)).toBe("paid");
    expect(await balance(r)).toBe(-2);
  });

  it("rejects a payment for a cancelled sale, keeps it visible as failed and moves no stock", async () => {
    const r = await ready();
    await pay(r);
    const [p] = await payments(r);
    await adminSql`update payments set status = 'expired' where id = ${p.id}`;
    await adminSql`update sales set status = 'cancelled' where id = ${r.saleId}`;
    expect(await confirm(r, p.id as string)).toBe("rejected");
    expect((await payments(r))[0].status).toBe("failed");
    expect(await saleStatus(r)).toBe("cancelled");
    expect(await movements(r)).toBe(0);
  });

  it("rejects a different paid amount and records what was paid", async () => {
    const r = await ready();
    await pay(r);
    const [p] = await payments(r);
    expect(await confirm(r, p.id as string, 999)).toBe("rejected");
    expect((await payments(r))[0].status).toBe("failed");
    expect(await saleStatus(r)).toBe("awaiting_payment");
    expect(await movements(r)).toBe(0);
    const [row] = await adminSql`select webhook_payload->>'paidAmountCents' as paid from payments where id = ${p.id}`;
    expect(row.paid).toBe("999");
  });

  it("rejects a second payment for a sale that is already paid, without a second stock movement", async () => {
    const r = await ready();
    await pay(r);
    const [first] = await payments(r);
    await confirm(r, first.id as string);
    const [second] = await adminSql`
      insert into payments (org_id, sale_id, provider, external_id, amount_cents, qr_payload, expires_at, status)
      values (${r.orgId}, ${r.saleId}, 'fake', 'late-qr', 1000, 'qr', now(), 'expired') returning id`;
    expect(await confirm(r, second.id as string)).toBe("rejected");
    expect(await movements(r)).toBe(1);
    expect(await balance(r)).toBe(-2);
  });

  it("answers not_found for an unknown payment", async () => {
    const r = await ready();
    expect(await codeOf(confirm(r, "6f1d3c9e-0000-4000-8000-000000000000"))).toBe("not_found");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- tests/domain/payments.test.ts`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar `src/domain/payments.ts`**

```ts
import type { Tx } from "@/db/tenant";
import { AppError } from "@/lib/errors";
import type { PaymentProvider } from "@/payments/provider";
import { type SaleView, type TerminalCtx, getSaleView, lockSale } from "./sales";

export const QR_TTL_MS = 3 * 60_000;

/**
 * Freezes the total and creates the Pix charge. A still-valid pending charge is returned as is.
 * ponytail: the provider call runs inside the transaction (holding the sale lock);
 * move it out if provider latency ever hurts.
 */
export async function startPayment(
  tx: Tx,
  orgId: string,
  term: TerminalCtx,
  saleId: string,
  provider: PaymentProvider,
  now: Date,
): Promise<SaleView> {
  const sale = await lockSale(tx, term, saleId, now);
  if (sale.status === "awaiting_payment") {
    const [pending] = await tx`
      select id from payments where sale_id = ${sale.id} and status = 'pending' and expires_at > ${now}`;
    if (pending) return getSaleView(tx, sale.id);
    await tx`update payments set status = 'expired' where sale_id = ${sale.id} and status = 'pending'`;
  } else if (sale.status !== "open") {
    throw new AppError("sale_not_editable");
  }

  const [t] = await tx`select total_cents from sales where id = ${sale.id}`;
  const [c] = await tx`select count(*)::int as n from sale_items where sale_id = ${sale.id}`;
  if (c.n === 0) throw new AppError("sale_empty");
  const amountCents = t.total_cents as number;
  const expiresAt = new Date(now.getTime() + QR_TTL_MS);

  let charge: Awaited<ReturnType<PaymentProvider["createPixCharge"]>>;
  try {
    charge = await provider.createPixCharge({ saleId: sale.id, amountCents, expiresAt });
  } catch {
    throw new AppError("provider_unavailable");
  }
  await tx`
    insert into payments (org_id, sale_id, provider, external_id, amount_cents, qr_payload, expires_at)
    values (${orgId}, ${sale.id}, ${provider.name}, ${charge.externalId}, ${amountCents}, ${charge.qrPayload}, ${charge.expiresAt})`;
  await tx`update sales set status = 'awaiting_payment' where id = ${sale.id}`;
  return getSaleView(tx, sale.id);
}

export type ConfirmResult = "confirmed" | "already_confirmed" | "rejected";

/**
 * Settles a payment: sale becomes paid and each item leaves stock, in one transaction.
 * A confirmed payment is never refused for stock reasons (balance may go negative).
 * Rejected (payment kept as failed, visible to the owner): wrong amount, cancelled sale,
 * or a sale already paid by another payment. Safe to call any number of times.
 */
export async function confirmPayment(
  tx: Tx,
  paymentId: string,
  paidAmountCents: number,
  event: unknown,
  now: Date,
): Promise<ConfirmResult> {
  const [ref] = await tx`select sale_id from payments where id = ${paymentId}`;
  if (!ref) throw new AppError("not_found");
  // Lock order is always sale, then payment (startPayment locks the sale first too): no deadlock.
  const [sale] = await tx`select id, status from sales where id = ${ref.sale_id} for update`;
  const [pay] = await tx`select status, amount_cents from payments where id = ${paymentId} for update`;
  if (pay.status === "confirmed") return "already_confirmed";

  const detail = JSON.stringify({ paidAmountCents, event });
  if (paidAmountCents !== pay.amount_cents || sale.status === "cancelled" || sale.status === "paid") {
    await tx`update payments set status = 'failed', webhook_payload = ${detail}::jsonb where id = ${paymentId}`;
    return "rejected";
  }
  await tx`update payments set status = 'confirmed', webhook_payload = ${detail}::jsonb where id = ${paymentId}`;
  await tx`update sales set status = 'paid', paid_at = ${now} where id = ${sale.id}`;
  await tx`
    insert into stock_movements (org_id, market_product_id, type, quantity, sale_id)
    select org_id, market_product_id, 'sale', -quantity, sale_id from sale_items where sale_id = ${sale.id}`;
  return "confirmed";
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -- tests/domain/payments.test.ts` (rodar 3 vezes: o teste de 20 confirmações simultâneas deve ser estável), depois `npm test && npm run typecheck`.
Expected: PASS e typecheck sem erros.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add startPayment and idempotent confirmPayment"
```

---

### Task 7: Reconciliação preguiçosa e webhook

**Files:**
- Create: `src/domain/refresh.ts`, `src/payments/webhook.ts`, `src/payments/reconcile.ts`
- Test: `tests/domain/refresh.test.ts`, `tests/payments/webhook.test.ts`, `tests/payments/reconcile.test.ts`

**Interfaces:**
- Consumes: `lockSale`, `getSaleView`, `CART_TTL_MS`, `TerminalCtx`, `SaleView` (Tarefa 5); `startPayment`, `confirmPayment` (Tarefa 6); `fakeProvider`, `buildFakeWebhook`, `getProvider`.
- Produces:
  - `CHECK_INTERVAL_MS = 10_000`; `refreshSale(tx, term, saleId, provider, now): Promise<SaleView>` (`@/domain/refresh`): expira carrinho abandonado, concilia com o provedor (no máximo a cada 10 s por pagamento) e devolve a venda a `open` quando o pagamento expirou ou falhou
  - `handleProviderWebhook(providerName: string, headers: Headers, rawBody: string, now?: Date): Promise<{ status: number; body: { result: string } }>` (`@/payments/webhook`): 404 `unknown_provider`, 401 `invalid_webhook`, 200 `ignored` / `unknown_payment` / `confirmed` / `already_confirmed` / `rejected`
  - `reconcilePending(now?: Date, limit?: number): Promise<number>` (`@/payments/reconcile`): visita as vendas `awaiting_payment` de todos os tenants e devolve quantas foram visitadas

- [ ] **Step 1: Escrever `tests/domain/refresh.test.ts`**

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { adminSql } from "@/db/client";
import { withOrg } from "@/db/tenant";
import { startPayment } from "@/domain/payments";
import { CHECK_INTERVAL_MS, refreshSale } from "@/domain/refresh";
import { addItemByBarcode } from "@/domain/sales";
import { getBalance } from "@/domain/stock";
import { buildFakeWebhook, fakeProvider } from "@/payments/fake";
import type { PaymentProvider } from "@/payments/provider";
import { makeOrg, resetDb, seedSellable, seedStore } from "../helpers";

beforeEach(resetDb);

const NOW = new Date("2026-10-02T12:00:00Z");
const at = (ms: number) => new Date(NOW.getTime() + ms);
const BARCODE = "7891000100103";

async function awaiting() {
  const orgId = await makeOrg("A");
  const store = await seedStore(orgId);
  const item = await seedSellable(orgId, store.marketId, { barcode: BARCODE, priceCents: 500 });
  const sale = await withOrg(orgId, (tx) => addItemByBarcode(tx, orgId, store, { barcode: BARCODE }, NOW));
  const view = await withOrg(orgId, (tx) => startPayment(tx, orgId, store, sale.id, fakeProvider, NOW));
  const externalId = view.payment!.qrPayload.split("|")[1];
  const refresh = (now: Date, provider: PaymentProvider = fakeProvider) =>
    withOrg(orgId, (tx) => refreshSale(tx, store, sale.id, provider, now));
  return { orgId, store, item, saleId: sale.id, externalId, refresh };
}

const counting = () => {
  const calls = { n: 0 };
  const provider: PaymentProvider = {
    ...fakeProvider,
    getCharge: async (id) => {
      calls.n++;
      return fakeProvider.getCharge(id);
    },
  };
  return { calls, provider };
};

describe("refreshSale", () => {
  it("pays the sale when the provider says the charge is confirmed", async () => {
    const r = await awaiting();
    buildFakeWebhook(r.externalId, { status: "confirmed" });
    const view = await r.refresh(at(CHECK_INTERVAL_MS));
    expect(view.status).toBe("paid");
    expect(await withOrg(r.orgId, (tx) => getBalance(tx, r.item.marketProductId))).toBe(-1);
  });

  it("keeps waiting while the charge is pending and asks the provider at most once per interval", async () => {
    const r = await awaiting();
    const { calls, provider } = counting();
    expect((await r.refresh(at(1000), provider)).status).toBe("awaiting_payment");
    expect(calls.n).toBe(1);
    await r.refresh(at(5000), provider);
    expect(calls.n).toBe(1);
    await r.refresh(at(1000 + CHECK_INTERVAL_MS), provider);
    expect(calls.n).toBe(2);
  });

  it("expires the payment and reopens the sale with the cart intact once the QR is old", async () => {
    const r = await awaiting();
    const view = await r.refresh(at(4 * 60_000));
    expect(view.status).toBe("open");
    expect(view.items).toHaveLength(1);
    expect(view.payment?.status).toBe("expired");
    expect(view.expiresAt).toEqual(at(4 * 60_000 + 5 * 60_000));
    const again = await withOrg(r.orgId, (tx) => startPayment(tx, r.orgId, r.store, r.saleId, fakeProvider, at(4 * 60_000)));
    expect(again.status).toBe("awaiting_payment");
    expect(again.payment?.qrPayload).not.toBe(view.payment?.qrPayload);
  });

  it("expires the payment early when the provider reports it expired", async () => {
    const r = await awaiting();
    buildFakeWebhook(r.externalId, { status: "expired" });
    const view = await r.refresh(at(CHECK_INTERVAL_MS));
    expect([view.status, view.payment?.status]).toEqual(["open", "expired"]);
  });

  it("reopens the sale when the provider reports the charge failed", async () => {
    const r = await awaiting();
    buildFakeWebhook(r.externalId, { status: "failed" });
    const view = await r.refresh(at(CHECK_INTERVAL_MS));
    expect([view.status, view.payment?.status]).toEqual(["open", "failed"]);
  });

  it("does not crash or confirm when the provider is down", async () => {
    const r = await awaiting();
    const down: PaymentProvider = {
      ...fakeProvider,
      getCharge: async () => {
        throw new Error("provider down");
      },
    };
    expect((await r.refresh(at(CHECK_INTERVAL_MS), down)).status).toBe("awaiting_payment");
    expect((await r.refresh(at(4 * 60_000), down)).status).toBe("open");
  });

  it("returns an awaiting sale with no pending payment to open", async () => {
    const r = await awaiting();
    await adminSql`update payments set status = 'failed' where sale_id = ${r.saleId}`;
    expect((await r.refresh(at(1000))).status).toBe("open");
  });

  it("expires an abandoned cart and persists it", async () => {
    const orgId = await makeOrg("A");
    const store = await seedStore(orgId);
    await seedSellable(orgId, store.marketId, { barcode: BARCODE });
    const sale = await withOrg(orgId, (tx) => addItemByBarcode(tx, orgId, store, { barcode: BARCODE }, NOW));
    const view = await withOrg(orgId, (tx) => refreshSale(tx, store, sale.id, fakeProvider, at(6 * 60_000)));
    expect(view.status).toBe("expired");
    const [row] = await adminSql`select status from sales where id = ${sale.id}`;
    expect(row.status).toBe("expired");
  });
});
```

- [ ] **Step 2: Escrever `tests/payments/webhook.test.ts`**

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { adminSql } from "@/db/client";
import { withOrg } from "@/db/tenant";
import { startPayment } from "@/domain/payments";
import { addItemByBarcode } from "@/domain/sales";
import { buildFakeWebhook, fakeProvider } from "@/payments/fake";
import { handleProviderWebhook } from "@/payments/webhook";
import { makeOrg, resetDb, seedSellable, seedStore } from "../helpers";

beforeEach(resetDb);

const NOW = new Date("2026-10-02T12:00:00Z");
const BARCODE = "7891000100103";

async function awaiting() {
  const orgId = await makeOrg("A");
  const store = await seedStore(orgId);
  await seedSellable(orgId, store.marketId, { barcode: BARCODE, priceCents: 500 });
  const sale = await withOrg(orgId, (tx) => addItemByBarcode(tx, orgId, store, { barcode: BARCODE }, NOW));
  const view = await withOrg(orgId, (tx) => startPayment(tx, orgId, store, sale.id, fakeProvider, NOW));
  return { saleId: sale.id, externalId: view.payment!.qrPayload.split("|")[1] };
}
const movements = async (saleId: string) =>
  (await adminSql`select count(*)::int as n from stock_movements where sale_id = ${saleId}`)[0].n as number;
const status = async (saleId: string) =>
  (await adminSql`select status from sales where id = ${saleId}`)[0].status as string;

describe("handleProviderWebhook", () => {
  it("confirms a genuine webhook and pays the sale", async () => {
    const { saleId, externalId } = await awaiting();
    const { headers, rawBody } = buildFakeWebhook(externalId);
    expect(await handleProviderWebhook("fake", headers, rawBody, NOW)).toEqual({ status: 200, body: { result: "confirmed" } });
    expect(await status(saleId)).toBe("paid");
    expect(await movements(saleId)).toBe(1);
  });

  it("answers 401 to a bad signature and changes nothing", async () => {
    const { saleId, externalId } = await awaiting();
    const { rawBody } = buildFakeWebhook(externalId);
    const r = await handleProviderWebhook("fake", new Headers({ "x-fake-signature": "00" }), rawBody, NOW);
    expect([r.status, r.body.result]).toEqual([401, "invalid_webhook"]);
    expect(await status(saleId)).toBe("awaiting_payment");
  });

  it("answers 401 to a body that is not even JSON", async () => {
    await awaiting();
    const r = await handleProviderWebhook("fake", new Headers({ "x-fake-signature": "00" }), "not json", NOW);
    expect(r.status).toBe(401);
  });

  it.each(["nope", "constructor", "__proto__"])("answers 404 to the unknown provider %s", async (name) => {
    const r = await handleProviderWebhook(name, new Headers(), "{}", NOW);
    expect([r.status, r.body.result]).toEqual([404, "unknown_provider"]);
  });

  it("answers 200 and ignores an unknown payment", async () => {
    await awaiting();
    const { headers, rawBody } = buildFakeWebhook("fake_unknown");
    expect(await handleProviderWebhook("fake", headers, rawBody, NOW)).toEqual({ status: 200, body: { result: "unknown_payment" } });
  });

  it("confirms once when the same webhook is delivered again", async () => {
    const { saleId, externalId } = await awaiting();
    const { headers, rawBody } = buildFakeWebhook(externalId);
    await handleProviderWebhook("fake", headers, rawBody, NOW);
    expect((await handleProviderWebhook("fake", headers, rawBody, NOW)).body.result).toBe("already_confirmed");
    expect(await movements(saleId)).toBe(1);
  });

  it("confirms once when ten deliveries race", async () => {
    const { saleId, externalId } = await awaiting();
    const { headers, rawBody } = buildFakeWebhook(externalId);
    const results = await Promise.all(Array.from({ length: 10 }, () => handleProviderWebhook("fake", headers, rawBody, NOW)));
    expect(results.filter((r) => r.body.result === "confirmed")).toHaveLength(1);
    expect(await movements(saleId)).toBe(1);
  });

  it("does not pay the sale when the amount differs", async () => {
    const { saleId, externalId } = await awaiting();
    const { headers, rawBody } = buildFakeWebhook(externalId, { amountCents: 499 });
    expect((await handleProviderWebhook("fake", headers, rawBody, NOW)).body.result).toBe("rejected");
    expect(await status(saleId)).toBe("awaiting_payment");
    expect(await movements(saleId)).toBe(0);
  });

  it("ignores expired and failed events (reconciliation reads the provider instead)", async () => {
    const { saleId, externalId } = await awaiting();
    const { headers, rawBody } = buildFakeWebhook(externalId, { status: "failed" });
    expect((await handleProviderWebhook("fake", headers, rawBody, NOW)).body.result).toBe("ignored");
    expect(await status(saleId)).toBe("awaiting_payment");
  });
});
```

- [ ] **Step 3: Escrever `tests/payments/reconcile.test.ts`**

```ts
import { beforeEach, expect, it } from "vitest";
import { adminSql } from "@/db/client";
import { withOrg } from "@/db/tenant";
import { startPayment } from "@/domain/payments";
import { addItemByBarcode } from "@/domain/sales";
import { buildFakeWebhook, fakeProvider } from "@/payments/fake";
import { reconcilePending } from "@/payments/reconcile";
import { makeOrg, resetDb, seedSellable, seedStore } from "../helpers";

beforeEach(resetDb);

const NOW = new Date("2026-10-02T12:00:00Z");

async function awaitingIn(name: string) {
  const orgId = await makeOrg(name);
  const store = await seedStore(orgId);
  await seedSellable(orgId, store.marketId, { barcode: "B-1", priceCents: 500 });
  const sale = await withOrg(orgId, (tx) => addItemByBarcode(tx, orgId, store, { barcode: "B-1" }, NOW));
  const view = await withOrg(orgId, (tx) => startPayment(tx, orgId, store, sale.id, fakeProvider, NOW));
  return { saleId: sale.id, externalId: view.payment!.qrPayload.split("|")[1] };
}

it("pays sales of every tenant whose provider already confirmed, and leaves the rest waiting", async () => {
  const a = await awaitingIn("A");
  const b = await awaitingIn("B");
  const c = await awaitingIn("C");
  buildFakeWebhook(a.externalId);
  buildFakeWebhook(b.externalId);
  const later = new Date(NOW.getTime() + 20_000);
  expect(await reconcilePending(later)).toBe(3);
  const rows = await adminSql`select id, status from sales order by created_at`;
  const byId = Object.fromEntries(rows.map((r) => [r.id as string, r.status as string]));
  expect([byId[a.saleId], byId[b.saleId], byId[c.saleId]]).toEqual(["paid", "paid", "awaiting_payment"]);
});
```

- [ ] **Step 4: Rodar e ver falhar**

Run: `npm test -- tests/domain/refresh.test.ts tests/payments`
Expected: FAIL (módulos não existem).

- [ ] **Step 5: Implementar `src/domain/refresh.ts`**

```ts
import type { Tx } from "@/db/tenant";
import type { PaymentProvider } from "@/payments/provider";
import { confirmPayment } from "./payments";
import { CART_TTL_MS, type SaleView, type TerminalCtx, getSaleView, lockSale } from "./sales";

export const CHECK_INTERVAL_MS = 10_000;

async function reopen(tx: Tx, saleId: string, now: Date): Promise<void> {
  await tx`
    update sales set status = 'open', expires_at = ${new Date(now.getTime() + CART_TTL_MS)}
    where id = ${saleId}`;
}

/**
 * Runs on every read of a sale. Expires an abandoned cart and reconciles a pending payment with
 * the provider (at most once per CHECK_INTERVAL_MS), covering a lost webhook. An old QR with no
 * payment confirmed expires and the sale returns to open with the cart intact; a payment that
 * still arrives later is accepted by confirmPayment.
 * ponytail: the provider call runs inside the transaction (holding the sale lock).
 */
export async function refreshSale(
  tx: Tx,
  term: TerminalCtx,
  saleId: string,
  provider: PaymentProvider,
  now: Date,
): Promise<SaleView> {
  const sale = await lockSale(tx, term, saleId, now);
  if (sale.status === "awaiting_payment") {
    const [p] = await tx`
      select id, external_id, expires_at, checked_at from payments
      where sale_id = ${sale.id} and status = 'pending'`;
    if (!p) {
      await reopen(tx, sale.id, now); // the last payment already expired or failed
    } else if (!p.checked_at || now.getTime() - (p.checked_at as Date).getTime() >= CHECK_INTERVAL_MS) {
      let charge: Awaited<ReturnType<PaymentProvider["getCharge"]>> | null = null;
      try {
        charge = await provider.getCharge(p.external_id as string);
      } catch {
        // provider down: keep waiting, or let an old QR expire below
      }
      await tx`update payments set checked_at = ${now} where id = ${p.id}`;
      if (charge?.status === "confirmed") {
        await confirmPayment(tx, p.id as string, charge.amountCents, { source: "reconcile" }, now);
      } else if (charge?.status === "failed") {
        await tx`update payments set status = 'failed' where id = ${p.id}`;
        await reopen(tx, sale.id, now);
      } else if (charge?.status === "expired" || (p.expires_at as Date) <= now) {
        await tx`update payments set status = 'expired' where id = ${p.id}`;
        await reopen(tx, sale.id, now);
      }
    }
  }
  return getSaleView(tx, sale.id);
}
```

- [ ] **Step 6: Implementar `src/payments/webhook.ts`**

```ts
import { adminSql } from "@/db/client";
import { withOrg } from "@/db/tenant";
import { confirmPayment } from "@/domain/payments";
import type { PaymentProvider } from "./provider";
import { getProvider } from "./registry";

type Outcome = { status: number; body: { result: string } };

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

/**
 * Provider callback. No session and no organization yet: verify the signature, find the payment
 * with adminSql (only to learn the organization), then confirm inside withOrg. Idempotent.
 */
export async function handleProviderWebhook(
  providerName: string,
  headers: Headers,
  rawBody: string,
  now: Date = new Date(),
): Promise<Outcome> {
  let provider: PaymentProvider;
  try {
    provider = getProvider(providerName);
  } catch {
    return { status: 404, body: { result: "unknown_provider" } };
  }
  let event: ReturnType<PaymentProvider["parseWebhook"]>;
  try {
    event = provider.parseWebhook(headers, rawBody);
  } catch {
    return { status: 401, body: { result: "invalid_webhook" } };
  }
  // ponytail: expired and failed events are ignored; refreshSale reads the same state from the provider.
  if (!event || event.status !== "confirmed") return { status: 200, body: { result: "ignored" } };

  const [p] = await adminSql`
    select id, org_id from payments where provider = ${provider.name} and external_id = ${event.externalId}`;
  if (!p) return { status: 200, body: { result: "unknown_payment" } };
  const result = await withOrg(p.org_id as string, (tx) =>
    confirmPayment(tx, p.id as string, event.amountCents, safeJson(rawBody), now),
  );
  return { status: 200, body: { result } };
}
```

- [ ] **Step 7: Implementar `src/payments/reconcile.ts`**

```ts
import { adminSql } from "@/db/client";
import { withOrg } from "@/db/tenant";
import { refreshSale } from "@/domain/refresh";
import { getProvider } from "./registry";

/**
 * Cross-tenant sweep of sales still awaiting payment (webhook lost and the totem gone).
 * Meant to be called by a cron through POST /api/internal/reconcile (scheduled in phase 3).
 * ponytail: uses the global provider; resolve it from payments.provider once adapters are per organization.
 */
export async function reconcilePending(now: Date = new Date(), limit = 100): Promise<number> {
  const rows = await adminSql`
    select id, org_id, market_id, terminal_id from sales
    where status = 'awaiting_payment' order by created_at limit ${limit}`;
  let visited = 0;
  for (const r of rows) {
    try {
      await withOrg(r.org_id as string, (tx) =>
        refreshSale(
          tx,
          { terminalId: r.terminal_id as string, marketId: r.market_id as string },
          r.id as string,
          getProvider(),
          now,
        ),
      );
      visited++;
    } catch (e) {
      console.error("reconcile failed for sale", r.id, e); // one bad sale must not stop the sweep
    }
  }
  return visited;
}
```

- [ ] **Step 8: Rodar e ver passar**

Run: `npm test && npm run typecheck`
Expected: PASS e typecheck sem erros.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: add lazy reconciliation, provider webhook handler and reconcile sweep"
```

---

### Task 8: API do totem e rotas de webhook

**Files:**
- Create: `src/pdv/http.ts`
- Create: `src/app/api/pdv/ping/route.ts`, `src/app/api/pdv/sales/items/route.ts`, `src/app/api/pdv/sales/[id]/route.ts`, `src/app/api/pdv/sales/[id]/items/[itemId]/route.ts`, `src/app/api/pdv/sales/[id]/pay/route.ts`, `src/app/api/pdv/sales/[id]/cancel/route.ts`
- Create: `src/app/api/webhooks/pix/[provider]/route.ts`, `src/app/api/dev/fake-pix/[externalId]/pay/route.ts`, `src/app/api/internal/reconcile/route.ts`
- Test: `tests/pdv/handlers.test.ts`, `tests/pdv/routes.test.ts`

**Interfaces:**
- Consumes: `requireTerminal`, `TerminalAuth`, `addItemByBarcode`, `setItemQuantity`, `cancelSale`, `startPayment`, `refreshSale`, `getProvider`, `handleProviderWebhook`, `reconcilePending`, `buildFakeWebhook`, `createTerminal`, `revokeTerminal`.
- Produces (`@/pdv/http`): `errorResponse(e: unknown): Response`; handlers `pingHandler(req)`, `scanHandler(req, now?)`, `setQuantityHandler(req, saleId, itemId, now?)`, `payHandler(req, saleId, now?)`, `getSaleHandler(req, saleId, now?)`, `cancelHandler(req, saleId, now?)`, todos devolvendo `Promise<Response>` com JSON `SaleView` (ou `{ ok: true }` no ping) ou `{ error, message }`. Status: 400 `invalid_input`; 401 `unauthorized` e `terminal_revoked`; 403 `forbidden`; 404 `not_found`, `sale_not_found`, `product_not_found`, `product_inactive`; 409 `sale_not_editable`; 422 `sale_empty`, `sale_too_large`, `quantity_limit`; 503 `provider_unavailable`; qualquer outro erro inesperado 500 genérico.

- [ ] **Step 1: Escrever `tests/pdv/handlers.test.ts`**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withOrg } from "@/db/tenant";
import { createTerminal, revokeTerminal } from "@/domain/terminals";
import { buildFakeWebhook } from "@/payments/fake";
import {
  cancelHandler, getSaleHandler, payHandler, pingHandler, scanHandler, setQuantityHandler,
} from "@/pdv/http";
import { handleProviderWebhook } from "@/payments/webhook";
import { makeOrg, resetDb, seedSellable, seedStore } from "../helpers";

beforeEach(resetDb);
afterEach(() => vi.unstubAllEnvs());

const BARCODE = "7891000100103";

const call = (token: string | undefined, body?: unknown, raw?: string) =>
  new Request("http://m77.test/api/pdv/x", {
    method: "POST",
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });

async function setup() {
  const orgId = await makeOrg("A");
  const store = await seedStore(orgId);
  await seedSellable(orgId, store.marketId, { barcode: BARCODE, priceCents: 500 });
  const { id, token } = await withOrg(orgId, (tx) =>
    createTerminal(tx, orgId, { marketId: store.marketId, name: "Totem 1" }),
  );
  return { orgId, store, terminalId: id, token };
}
type Setup = Awaited<ReturnType<typeof setup>>;

const json = async (res: Response) => (await res.json()) as Record<string, any>;
async function scan(s: Setup, saleId?: string, barcode = BARCODE) {
  return json(await scanHandler(call(s.token, { saleId, barcode })));
}

describe("terminal authentication", () => {
  it("answers 401 without a token, with a garbage token and with a revoked token", async () => {
    const s = await setup();
    expect((await pingHandler(call(undefined))).status).toBe(401);
    const garbage = await pingHandler(call("garbage"));
    expect([garbage.status, (await json(garbage)).error]).toEqual([401, "unauthorized"]);
    await withOrg(s.orgId, (tx) => revokeTerminal(tx, s.terminalId));
    const revoked = await pingHandler(call(s.token));
    expect([revoked.status, (await json(revoked)).error]).toEqual([401, "terminal_revoked"]);
  });

  it("answers ok to a valid token", async () => {
    const s = await setup();
    expect(await json(await pingHandler(call(s.token)))).toEqual({ ok: true });
  });
});

describe("scan and edit", () => {
  it("creates a sale with the scanned item", async () => {
    const s = await setup();
    const sale = await scan(s);
    expect([sale.status, sale.totalCents, sale.items[0].quantity]).toEqual(["open", 500, 1]);
    expect(typeof sale.expiresAt).toBe("string");
  });

  it("answers 404 for an unknown barcode, 400 for a broken body and 404 for a malformed sale id", async () => {
    const s = await setup();
    const unknown = await scanHandler(call(s.token, { barcode: "0000" }));
    expect([unknown.status, (await json(unknown)).error]).toEqual([404, "product_not_found"]);
    expect((await scanHandler(call(s.token, undefined, "{not json"))).status).toBe(400);
    expect((await scanHandler(call(s.token, { barcode: "" }))).status).toBe(400);
    const bad = await scanHandler(call(s.token, { saleId: "nope", barcode: BARCODE }));
    expect([bad.status, (await json(bad)).error]).toEqual([404, "sale_not_found"]);
  });

  it("changes a quantity and rejects bad ones without a 500", async () => {
    const s = await setup();
    const sale = await scan(s);
    const itemId = sale.items[0].id;
    const patch = (id: string, quantity: unknown) =>
      setQuantityHandler(call(s.token, { quantity }), sale.id, id);
    const ok = await patch(itemId, 3);
    expect([ok.status, (await json(ok)).totalCents]).toEqual([200, 1500]);
    expect((await patch(itemId, 100)).status).toBe(400);
    expect((await patch(itemId, "x")).status).toBe(400);
    expect((await patch("nope", 1)).status).toBe(404);
  });
});

describe("payment flow", () => {
  it("pays through the webhook and the totem sees the sale paid", async () => {
    const s = await setup();
    const sale = await scan(s);
    const payRes = await payHandler(call(s.token), sale.id);
    const paying = await json(payRes);
    expect([payRes.status, paying.status]).toEqual([200, "awaiting_payment"]);
    expect(paying.payment.qrPayload).toMatch(/^FAKEPIX\|/);
    const waiting = await json(await getSaleHandler(call(s.token), sale.id));
    expect(waiting.status).toBe("awaiting_payment");
    const externalId = paying.payment.qrPayload.split("|")[1];
    const { headers, rawBody } = buildFakeWebhook(externalId);
    expect((await handleProviderWebhook("fake", headers, rawBody)).body.result).toBe("confirmed");
    expect((await json(await getSaleHandler(call(s.token), sale.id))).status).toBe("paid");
  });

  it("answers 422 sale_empty and 409 once the sale is cancelled", async () => {
    const s = await setup();
    const sale = await scan(s);
    await setQuantityHandler(call(s.token, { quantity: 0 }), sale.id, sale.items[0].id);
    const empty = await payHandler(call(s.token), sale.id);
    expect([empty.status, (await json(empty)).error]).toEqual([422, "sale_empty"]);
    const cancelled = await json(await cancelHandler(call(s.token), sale.id));
    expect(cancelled.status).toBe("cancelled");
    const again = await payHandler(call(s.token), sale.id);
    expect([again.status, (await json(again)).error]).toEqual([409, "sale_not_editable"]);
  });

  it("answers 503 provider_unavailable when the provider cannot create the charge", async () => {
    const s = await setup();
    const sale = await scan(s);
    vi.stubEnv("FAKE_PIX_SECRET", "");
    const res = await payHandler(call(s.token), sale.id);
    expect([res.status, (await json(res)).error]).toEqual([503, "provider_unavailable"]);
  });
});

describe("isolation", () => {
  it("hides a sale from another terminal of the same organization and from another organization", async () => {
    const s = await setup();
    const sale = await scan(s);
    const second = await withOrg(s.orgId, (tx) =>
      createTerminal(tx, s.orgId, { marketId: s.store.marketId, name: "Totem 2" }),
    );
    expect((await getSaleHandler(call(second.token), sale.id)).status).toBe(404);
    const other = await setup();
    expect((await getSaleHandler(call(other.token), sale.id)).status).toBe(404);
    expect((await cancelHandler(call(other.token), sale.id)).status).toBe(404);
  });
});
```

- [ ] **Step 2: Escrever `tests/pdv/routes.test.ts`**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withOrg } from "@/db/tenant";
import { startPayment } from "@/domain/payments";
import { addItemByBarcode } from "@/domain/sales";
import { buildFakeWebhook, fakeProvider } from "@/payments/fake";
import { POST as reconcileRoute } from "@/app/api/internal/reconcile/route";
import { POST as devPayRoute } from "@/app/api/dev/fake-pix/[externalId]/pay/route";
import { POST as webhookRoute } from "@/app/api/webhooks/pix/[provider]/route";
import { makeOrg, resetDb, seedSellable, seedStore } from "../helpers";

beforeEach(resetDb);
afterEach(() => vi.unstubAllEnvs());

const NOW = new Date("2026-10-02T12:00:00Z");
const ctx = <T extends object>(p: T) => ({ params: Promise.resolve(p) });

async function awaiting() {
  const orgId = await makeOrg("A");
  const store = await seedStore(orgId);
  await seedSellable(orgId, store.marketId, { barcode: "B-1", priceCents: 500 });
  const sale = await withOrg(orgId, (tx) => addItemByBarcode(tx, orgId, store, { barcode: "B-1" }, NOW));
  const view = await withOrg(orgId, (tx) => startPayment(tx, orgId, store, sale.id, fakeProvider, NOW));
  return view.payment!.qrPayload.split("|")[1];
}

describe("webhook route", () => {
  it("answers 401 to a forged webhook and 404 to an unknown provider", async () => {
    const forged = new Request("http://m77.test/api/webhooks/pix/fake", {
      method: "POST",
      headers: { "x-fake-signature": "00" },
      body: "{}",
    });
    expect((await webhookRoute(forged, ctx({ provider: "fake" }))).status).toBe(401);
    const unknown = new Request("http://m77.test/x", { method: "POST", body: "{}" });
    expect((await webhookRoute(unknown, ctx({ provider: "constructor" }))).status).toBe(404);
  });

  it("confirms through the real route with a signed body", async () => {
    const externalId = await awaiting();
    const { headers, rawBody } = buildFakeWebhook(externalId);
    const res = await webhookRoute(
      new Request("http://m77.test/x", { method: "POST", headers, body: rawBody }),
      ctx({ provider: "fake" }),
    );
    expect([res.status, await res.json()]).toEqual([200, { result: "confirmed" }]);
  });
});

describe("dev fake-pay route", () => {
  it("pays a charge outside production and is a 404 in production", async () => {
    const externalId = await awaiting();
    const ok = await devPayRoute(new Request("http://m77.test/x", { method: "POST" }), ctx({ externalId }));
    expect([ok.status, await ok.json()]).toEqual([200, { result: "confirmed" }]);
    vi.stubEnv("NODE_ENV", "production");
    const blocked = await devPayRoute(new Request("http://m77.test/x", { method: "POST" }), ctx({ externalId }));
    expect(blocked.status).toBe(404);
  });
});

describe("reconcile route", () => {
  const call = (secret?: string) =>
    reconcileRoute(
      new Request("http://m77.test/api/internal/reconcile", {
        method: "POST",
        headers: secret ? { "x-reconcile-secret": secret } : {},
      }),
    );

  it("is a 404 without a configured secret, 401 with a wrong one and 200 with the right one", async () => {
    vi.stubEnv("RECONCILE_SECRET", "");
    expect((await call("anything")).status).toBe(404);
    vi.stubEnv("RECONCILE_SECRET", "s3cret");
    expect((await call()).status).toBe(401);
    expect((await call("wrong!")).status).toBe(401);
    const ok = await call("s3cret");
    expect([ok.status, await ok.json()]).toEqual([200, { visited: 0 }]);
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npm test -- tests/pdv`
Expected: FAIL (módulos não existem).

- [ ] **Step 4: Implementar `src/pdv/http.ts`**

```ts
import { withOrg } from "@/db/tenant";
import { startPayment } from "@/domain/payments";
import { refreshSale } from "@/domain/refresh";
import { addItemByBarcode, cancelSale, setItemQuantity } from "@/domain/sales";
import { AppError } from "@/lib/errors";
import { message } from "@/lib/messages";
import { getProvider } from "@/payments/registry";
import { type TerminalAuth, requireTerminal } from "./auth";

const STATUS: Record<string, number> = {
  invalid_input: 400,
  unauthorized: 401,
  terminal_revoked: 401,
  forbidden: 403,
  not_found: 404,
  sale_not_found: 404,
  product_not_found: 404,
  product_inactive: 404,
  sale_not_editable: 409,
  sale_empty: 422,
  sale_too_large: 422,
  quantity_limit: 422,
  provider_unavailable: 503,
};

export function errorResponse(e: unknown): Response {
  if (e instanceof AppError) {
    return Response.json({ error: e.code, message: message(e.code) }, { status: STATUS[e.code] ?? 400 });
  }
  console.error(e);
  return Response.json({ error: "internal", message: message("internal") }, { status: 500 });
}

async function handle(req: Request, fn: (t: TerminalAuth) => Promise<unknown>): Promise<Response> {
  try {
    return Response.json(await fn(await requireTerminal(req)));
  } catch (e) {
    return errorResponse(e);
  }
}

async function bodyOf(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new AppError("invalid_input");
  }
}

const ctx = (t: TerminalAuth) => ({ terminalId: t.terminalId, marketId: t.marketId });

export const pingHandler = (req: Request) => handle(req, async () => ({ ok: true }));

export const scanHandler = (req: Request, now: Date = new Date()) =>
  handle(req, async (t) => {
    const raw = await bodyOf(req);
    return withOrg(t.orgId, (tx) => addItemByBarcode(tx, t.orgId, ctx(t), raw, now));
  });

export const setQuantityHandler = (req: Request, saleId: string, itemId: string, now: Date = new Date()) =>
  handle(req, async (t) => {
    const body = (await bodyOf(req)) as { quantity?: unknown } | null;
    return withOrg(t.orgId, (tx) =>
      setItemQuantity(tx, ctx(t), saleId, { itemId, quantity: body?.quantity }, now),
    );
  });

export const payHandler = (req: Request, saleId: string, now: Date = new Date()) =>
  handle(req, (t) =>
    withOrg(t.orgId, (tx) => startPayment(tx, t.orgId, ctx(t), saleId, getProvider(), now)),
  );

export const getSaleHandler = (req: Request, saleId: string, now: Date = new Date()) =>
  handle(req, (t) => withOrg(t.orgId, (tx) => refreshSale(tx, ctx(t), saleId, getProvider(), now)));

export const cancelHandler = (req: Request, saleId: string, now: Date = new Date()) =>
  handle(req, (t) => withOrg(t.orgId, (tx) => cancelSale(tx, ctx(t), saleId, now)));
```

- [ ] **Step 5: Criar os arquivos de rota**

Os handlers têm um segundo parâmetro opcional (`now`), que não pode receber o contexto do Next; por isso cada rota os chama por um invólucro.

`src/app/api/pdv/ping/route.ts`:

```ts
import { pingHandler } from "@/pdv/http";

export const GET = (req: Request) => pingHandler(req);
```

`src/app/api/pdv/sales/items/route.ts`:

```ts
import { scanHandler } from "@/pdv/http";

export const POST = (req: Request) => scanHandler(req);
```

`src/app/api/pdv/sales/[id]/route.ts`:

```ts
import { getSaleHandler } from "@/pdv/http";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return getSaleHandler(req, (await params).id);
}
```

`src/app/api/pdv/sales/[id]/items/[itemId]/route.ts`:

```ts
import { setQuantityHandler } from "@/pdv/http";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  const { id, itemId } = await params;
  return setQuantityHandler(req, id, itemId);
}
```

`src/app/api/pdv/sales/[id]/pay/route.ts`:

```ts
import { payHandler } from "@/pdv/http";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return payHandler(req, (await params).id);
}
```

`src/app/api/pdv/sales/[id]/cancel/route.ts`:

```ts
import { cancelHandler } from "@/pdv/http";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return cancelHandler(req, (await params).id);
}
```

`src/app/api/webhooks/pix/[provider]/route.ts`:

```ts
import { handleProviderWebhook } from "@/payments/webhook";

export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const r = await handleProviderWebhook(provider, req.headers, await req.text());
  return Response.json(r.body, { status: r.status });
}
```

`src/app/api/dev/fake-pix/[externalId]/pay/route.ts`:

```ts
import { buildFakeWebhook } from "@/payments/fake";
import { handleProviderWebhook } from "@/payments/webhook";

/** Dev only: makes the simulated provider pay a charge, through the real webhook path. */
export async function POST(_req: Request, { params }: { params: Promise<{ externalId: string }> }) {
  if (process.env.NODE_ENV === "production") return new Response(null, { status: 404 });
  const { externalId } = await params;
  const { headers, rawBody } = buildFakeWebhook(externalId);
  const r = await handleProviderWebhook("fake", headers, rawBody);
  return Response.json(r.body, { status: r.status });
}
```

`src/app/api/internal/reconcile/route.ts`:

```ts
import { timingSafeEqual } from "node:crypto";
import { reconcilePending } from "@/payments/reconcile";

/** Called by a cron (wired up in phase 3). Disabled unless RECONCILE_SECRET is set. */
export async function POST(req: Request) {
  const secret = process.env.RECONCILE_SECRET;
  if (!secret) return new Response(null, { status: 404 });
  const given = Buffer.from(req.headers.get("x-reconcile-secret") ?? "");
  const expected = Buffer.from(secret);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return new Response(null, { status: 401 });
  }
  return Response.json({ visited: await reconcilePending() });
}
```

- [ ] **Step 6: Rodar e ver passar**

Run: `npm test && npm run typecheck`
Expected: PASS e typecheck sem erros.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add PDV API, provider webhook, fake pay and reconcile routes"
```

---

### Task 9: Tela do PDV (totem)

**Files:**
- Modify: `package.json`, `package-lock.json` (dependência `qrcode`)
- Create: `src/pdv/scanner.ts`, `src/app/pdv/page.tsx`, `src/app/pdv/PdvApp.tsx`, `src/app/manifest.ts`
- Test: `tests/pdv/scanner.test.ts`

**Interfaces:**
- Consumes: as rotas `/api/pdv/*` da Tarefa 8 (corpo e respostas JSON de `SaleView` com datas em ISO), `formatBRL`.
- Produces: `createScanner(onScan: (code: string) => void, maxGapMs?: number): (key: string, now: number) => void` (`@/pdv/scanner`); página `/pdv`; manifesto mínimo em `/manifest.webmanifest`.

- [ ] **Step 1: Escrever `tests/pdv/scanner.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { createScanner } from "@/pdv/scanner";

function type(feed: (k: string, t: number) => void, text: string, start = 0, gap = 10) {
  let t = start;
  for (const ch of text) feed(ch, (t += gap));
  return t;
}

describe("createScanner", () => {
  it("submits the accumulated code on Enter", () => {
    const seen: string[] = [];
    const feed = createScanner((c) => seen.push(c));
    const t = type(feed, "7891000100103", 0);
    feed("Enter", t + 10);
    expect(seen).toEqual(["7891000100103"]);
  });

  it("starts the next code from scratch", () => {
    const seen: string[] = [];
    const feed = createScanner((c) => seen.push(c));
    let t = type(feed, "AAAA", 0);
    feed("Enter", (t += 10));
    t = type(feed, "BBBB", t);
    feed("Enter", t + 10);
    expect(seen).toEqual(["AAAA", "BBBB"]);
  });

  it("ignores codes shorter than four characters and non-printable keys", () => {
    const seen: string[] = [];
    const feed = createScanner((c) => seen.push(c));
    let t = type(feed, "123", 0);
    feed("Enter", (t += 10));
    feed("Shift", (t += 10));
    feed("Tab", (t += 10));
    t = type(feed, "1234", t);
    feed("Enter", t + 10);
    expect(seen).toEqual(["1234"]);
  });

  it("drops stale characters when the gap between keys is too long", () => {
    const seen: string[] = [];
    const feed = createScanner((c) => seen.push(c), 500);
    type(feed, "XXXX", 0);
    const t = type(feed, "9999", 5000);
    feed("Enter", t + 10);
    expect(seen).toEqual(["9999"]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- tests/pdv/scanner.test.ts`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar `src/pdv/scanner.ts`**

```ts
/**
 * Barcode readers act as a keyboard: they type the code fast and finish with Enter.
 * Feed every keydown to the returned function; onScan fires with the accumulated code.
 */
export function createScanner(
  onScan: (code: string) => void,
  maxGapMs = 500,
): (key: string, now: number) => void {
  let buf = "";
  let last = 0;
  return (key, now) => {
    if (now - last > maxGapMs) buf = "";
    last = now;
    if (key === "Enter") {
      const code = buf;
      buf = "";
      if (code.length >= 4) onScan(code);
      return;
    }
    if (key.length === 1) buf += key;
  };
}
```

- [ ] **Step 4: Instalar a dependência do QR**

Run: `npm install qrcode && npm install -D @types/qrcode`
Expected: `package.json` ganha `qrcode` em `dependencies` e `@types/qrcode` em `devDependencies`.

- [ ] **Step 5: Criar `src/app/manifest.ts`**

```ts
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Market77 PDV",
    short_name: "PDV",
    start_url: "/pdv",
    display: "fullscreen",
    background_color: "#ffffff",
    theme_color: "#ffffff",
  };
}
```

- [ ] **Step 6: Criar `src/app/pdv/page.tsx`**

```tsx
import PdvApp from "./PdvApp";

export const metadata = { title: "Market77 PDV" };

export default function PdvPage() {
  return <PdvApp />;
}
```

- [ ] **Step 7: Criar `src/app/pdv/PdvApp.tsx`**

```tsx
"use client";
import QRCode from "qrcode";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { formatBRL } from "@/lib/money";
import { createScanner } from "@/pdv/scanner";

const TOKEN_KEY = "m77_terminal_token";

type Item = { id: string; productName: string; quantity: number; unitPriceCents: number };
type Payment = { status: string; qrPayload: string; expiresAt: string } | null;
type Sale = { id: string; status: string; totalCents: number; items: Item[]; payment: Payment };
type Result = { ok: boolean; status: number; data: Partial<Sale> & { error?: string; message?: string } };

const readToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};
const saveToken = (t: string | null) => {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // storage blocked: the token only lives until the page is closed
  }
};

async function call(token: string, method: string, path: string, body?: unknown): Promise<Result> {
  const res = await fetch(`/api/pdv${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
}

const page = {
  minHeight: "100vh",
  display: "flex",
  flexDirection: "column" as const,
  alignItems: "center",
  justifyContent: "center",
  gap: 16,
  padding: 24,
  fontSize: 28,
  fontFamily: "sans-serif",
  textAlign: "center" as const,
};
const bigButton = { fontSize: 28, padding: "16px 32px", minWidth: 220 };

function Screen({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <main style={page}>
      <h1 style={{ fontSize: 40, margin: 0 }}>{title}</h1>
      {children}
    </main>
  );
}

export default function PdvApp() {
  const [token, setToken] = useState<string | null | undefined>(undefined); // undefined: not read yet
  const [sale, setSale] = useState<Sale | null>(null);
  const [notice, setNotice] = useState("");
  const [offline, setOffline] = useState(false);
  const [revoked, setRevoked] = useState(false);
  const [qr, setQr] = useState("");
  const [now, setNow] = useState(Date.now());
  const [draft, setDraft] = useState("");
  const saleRef = useRef<Sale | null>(null);
  saleRef.current = sale;

  const flash = useCallback((text: string) => {
    setNotice(text);
    setTimeout(() => setNotice(""), 4000);
  }, []);

  useEffect(() => setToken(readToken()), []);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  /** Calls the API; handles offline and token problems. Returns null when the call did not complete. */
  const run = useCallback(
    async (method: string, path: string, body?: unknown): Promise<Result | null> => {
      if (!token) return null;
      try {
        const r = await call(token, method, path, body);
        setOffline(false);
        if (r.status === 401) {
          if (r.data.error === "terminal_revoked") setRevoked(true);
          else {
            saveToken(null);
            setToken(null);
          }
          return null;
        }
        return r;
      } catch {
        setOffline(true);
        return null;
      }
    },
    [token],
  );

  const scan = useCallback(
    async (barcode: string) => {
      const cur = saleRef.current;
      if (cur && cur.status !== "open") return; // paying: ignore scans
      let r = await run("POST", "/sales/items", { saleId: cur?.id, barcode });
      if (cur && (r?.data.error === "sale_not_found" || r?.data.error === "sale_not_editable")) {
        r = await run("POST", "/sales/items", { barcode }); // the cart is gone on the server: start a new one
      }
      if (!r) return;
      if (r.ok) setSale(r.data as Sale);
      else flash(r.data.message ?? "Erro inesperado.");
    },
    [run, flash],
  );

  useEffect(() => {
    if (!token || offline || revoked) return;
    const feed = createScanner((code) => void scan(code));
    const onKey = (e: KeyboardEvent) => feed(e.key, Date.now());
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [token, offline, revoked, scan]);

  const saleId = sale?.id;
  useEffect(() => {
    if (!token || !saleId || revoked) return;
    const id = setInterval(async () => {
      const cur = saleRef.current;
      if (!cur) return;
      const r = await run("GET", `/sales/${cur.id}`);
      if (r?.ok) setSale(r.data as Sale);
      else if (r?.status === 404) setSale(null);
    }, 2000);
    return () => clearInterval(id);
  }, [token, saleId, revoked, run]);

  useEffect(() => {
    if (!offline) return;
    const id = setInterval(() => void run("GET", "/ping"), 3000);
    return () => clearInterval(id);
  }, [offline, run]);

  useEffect(() => {
    if (!sale) return;
    if (sale.status === "paid") {
      const t = setTimeout(() => setSale(null), 6000);
      return () => clearTimeout(t);
    }
    if (sale.status === "expired" || sale.status === "cancelled") {
      if (sale.status === "expired") flash("Carrinho encerrado por inatividade.");
      setSale(null);
    }
  }, [sale, flash]);

  const payload = sale?.status === "awaiting_payment" ? sale.payment?.qrPayload : undefined;
  useEffect(() => {
    if (!payload) {
      setQr("");
      return;
    }
    QRCode.toDataURL(payload, { margin: 1, width: 320 }).then(setQr).catch(() => setQr(""));
  }, [payload]);

  async function connect() {
    const candidate = draft.trim();
    try {
      const res = await call(candidate, "GET", "/ping");
      if (res.ok) {
        saveToken(candidate);
        setToken(candidate);
        setDraft("");
      } else flash(res.data.message ?? "Token inválido.");
    } catch {
      flash("Sem conexão.");
    }
  }

  async function changeQuantity(item: Item, delta: number) {
    if (!sale) return;
    const r = await run("PATCH", `/sales/${sale.id}/items/${item.id}`, { quantity: item.quantity + delta });
    if (r?.ok) setSale(r.data as Sale);
    else if (r) flash(r.data.message ?? "Erro inesperado.");
  }

  async function startPay() {
    if (!sale) return;
    const r = await run("POST", `/sales/${sale.id}/pay`);
    if (r?.ok) setSale(r.data as Sale);
    else if (r) flash(r.data.message ?? "Erro inesperado.");
  }

  async function cancel() {
    if (!sale) return;
    await run("POST", `/sales/${sale.id}/cancel`);
    setSale(null);
  }

  if (token === undefined) return null;
  if (!token) {
    return (
      <Screen title="Configurar totem">
        <p>Cole o token do totem (gerado no painel, em Totens).</p>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          style={{ fontSize: 24, padding: 12, width: "80%" }}
          aria-label="Token do totem"
        />
        <button style={bigButton} onClick={connect} disabled={!draft.trim()}>
          Conectar
        </button>
        {notice && <p role="alert">{notice}</p>}
      </Screen>
    );
  }
  if (revoked) return <Screen title="Totem desativado">Procure o responsável pela loja.</Screen>;
  if (offline) return <Screen title="Totem indisponível">Sem conexão. Tentando novamente...</Screen>;

  if (!sale) {
    return (
      <Screen title="Bem-vindo">
        <p>Escaneie um produto para começar.</p>
        {notice && <p role="alert">{notice}</p>}
      </Screen>
    );
  }
  if (sale.status === "paid") {
    return (
      <Screen title="Obrigado!">
        <p>Pagamento confirmado.</p>
      </Screen>
    );
  }
  if (sale.status === "awaiting_payment") {
    const left = Math.max(0, Math.round((new Date(sale.payment?.expiresAt ?? 0).getTime() - now) / 1000));
    return (
      <Screen title={`Pague ${formatBRL(sale.totalCents)} com Pix`}>
        {qr && <img src={qr} alt="QR code do Pix" width={320} height={320} />}
        <p style={{ fontSize: 18, wordBreak: "break-all", maxWidth: 560 }}>{sale.payment?.qrPayload}</p>
        <p>Expira em {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}</p>
      </Screen>
    );
  }
  return (
    <Screen title="Seu carrinho">
      {sale.payment?.status === "expired" && <p role="alert">O QR expirou. Gere um novo para pagar.</p>}
      {notice && <p role="alert">{notice}</p>}
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {sale.items.map((i) => (
          <li key={i.id} style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "center" }}>
            <button style={{ fontSize: 28, width: 56 }} onClick={() => changeQuantity(i, -1)} aria-label="Menos">
              -
            </button>
            <span>
              {i.quantity} x {i.productName} ({formatBRL(i.unitPriceCents)})
            </span>
            <button style={{ fontSize: 28, width: 56 }} onClick={() => changeQuantity(i, 1)} aria-label="Mais">
              +
            </button>
          </li>
        ))}
      </ul>
      <p>
        <strong>Total: {formatBRL(sale.totalCents)}</strong>
      </p>
      <button style={bigButton} onClick={startPay} disabled={sale.items.length === 0}>
        Pagar com Pix
      </button>
      <button style={{ ...bigButton, fontSize: 20 }} onClick={cancel}>
        Cancelar
      </button>
    </Screen>
  );
}
```

- [ ] **Step 8: Rodar, tipar e checar a página**

Run: `npm test && npm run typecheck`
Expected: PASS e typecheck sem erros.

Run (smoke, com o `.env` presente e o banco migrado): `npm run dev -- -p 3457` em segundo plano; `curl -s -o /dev/null -w "%{http_code}" http://localhost:3457/pdv` deve imprimir `200` e `curl -s -o /dev/null -w "%{http_code}" http://localhost:3457/manifest.webmanifest` deve imprimir `200`; depois encerre o servidor por completo. A interface em si (leitor, QR, fluxo) só é verificada de verdade no roteiro manual da Tarefa 11: este projeto não tem testes de componente.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: add PDV totem screen, barcode scanner buffer and manifest"
```

---

### Task 10: Painel do dono (totens, vendas, dashboard)

**Files:**
- Create: `src/domain/sale-queries.ts`, `src/lib/labels.ts`
- Create: `src/app/o/[orgId]/terminals/page.tsx`, `src/app/o/[orgId]/terminals/actions.ts`, `src/app/o/[orgId]/terminals/TerminalForm.tsx`
- Create: `src/app/o/[orgId]/sales/page.tsx`, `src/app/o/[orgId]/sales/[saleId]/page.tsx`
- Modify: `src/app/o/[orgId]/layout.tsx`, `src/app/o/[orgId]/page.tsx`, `src/app/o/[orgId]/markets/[marketId]/page.tsx`
- Test: `tests/domain/sale-queries.test.ts`

**Interfaces:**
- Consumes: `listTerminals`, `createTerminal`, `revokeTerminal`, `listMarkets`, `requireOrg`, `requireOrgPage`, `redirectOnAppError`, `can`, `formatBRL`, `message`, `confirmPayment`.
- Produces (`@/domain/sale-queries`): `listRecentSales(tx, limit = 50): Promise<SaleListRow[]>` com `SaleListRow = { id; marketName; timezone; status; totalCents; itemCount; createdAt: Date }` (só vendas com itens, mais recentes primeiro); `getSaleDetail(tx, saleId): Promise<SaleDetail | null>` (`null` para id malformado ou inexistente) com `SaleDetail = { id; marketName; timezone; status; totalCents; createdAt: Date; paidAt: Date | null; items: { productName; quantity; unitPriceCents }[]; payments: { id; status; provider; amountCents; paidAmountCents: number | null; createdAt: Date }[] }`; `salesToday(tx, now?): Promise<{ totalCents: number; count: number }>` (vendas `paid` no dia de hoje do fuso de cada mercado). `STATUS_LABEL` e `PAYMENT_LABEL` (`@/lib/labels`).

- [ ] **Step 1: Escrever `tests/domain/sale-queries.test.ts`**

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { adminSql } from "@/db/client";
import { withOrg } from "@/db/tenant";
import { confirmPayment, startPayment } from "@/domain/payments";
import { getSaleDetail, listRecentSales, salesToday } from "@/domain/sale-queries";
import { addItemByBarcode } from "@/domain/sales";
import { fakeProvider } from "@/payments/fake";
import { makeOrg, resetDb, seedSellable, seedStore } from "../helpers";

beforeEach(resetDb);

const NOW = new Date("2026-10-02T12:00:00Z");

async function sold(orgId: string, store: { marketId: string; terminalId: string }, barcode: string, at = NOW) {
  const sale = await withOrg(orgId, (tx) => addItemByBarcode(tx, orgId, store, { barcode }, at));
  return sale.id;
}

async function setup(price = 500) {
  const orgId = await makeOrg("A");
  const store = await seedStore(orgId);
  await seedSellable(orgId, store.marketId, { barcode: "B-1", priceCents: price });
  return { orgId, store };
}

async function paid(orgId: string, store: { marketId: string; terminalId: string }, paidAt: Date) {
  const id = await sold(orgId, store, "B-1");
  const view = await withOrg(orgId, (tx) => startPayment(tx, orgId, store, id, fakeProvider, NOW));
  await withOrg(orgId, (tx) => confirmPayment(tx, view.payment!.id, view.totalCents, {}, paidAt));
  return id;
}

describe("listRecentSales", () => {
  it("lists newest first with item counts, skipping empty carts, and honors the limit", async () => {
    const { orgId, store } = await setup();
    await sold(orgId, store, "B-1");
    await sold(orgId, store, "B-1");
    await adminSql`insert into sales (org_id, market_id, terminal_id, expires_at) values (${orgId}, ${store.marketId}, ${store.terminalId}, now())`;
    const all = await withOrg(orgId, (tx) => listRecentSales(tx));
    expect(all).toHaveLength(2);
    expect(all[0].createdAt.getTime()).toBeGreaterThanOrEqual(all[1].createdAt.getTime());
    expect([all[0].marketName, all[0].status, all[0].itemCount, all[0].totalCents]).toEqual(["Loja", "open", 1, 500]);
    expect(await withOrg(orgId, (tx) => listRecentSales(tx, 1))).toHaveLength(1);
  });

  it("does not list another tenant's sales", async () => {
    const a = await setup();
    const b = await setup();
    await sold(b.orgId, b.store, "B-1");
    expect(await withOrg(a.orgId, (tx) => listRecentSales(tx))).toHaveLength(0);
  });
});

describe("getSaleDetail", () => {
  it("returns the items and a failed payment with expected and received amounts", async () => {
    const { orgId, store } = await setup();
    const id = await sold(orgId, store, "B-1");
    const view = await withOrg(orgId, (tx) => startPayment(tx, orgId, store, id, fakeProvider, NOW));
    await withOrg(orgId, (tx) => confirmPayment(tx, view.payment!.id, 499, {}, NOW));
    const d = await withOrg(orgId, (tx) => getSaleDetail(tx, id));
    expect(d?.items).toEqual([{ productName: "Água", quantity: 1, unitPriceCents: 500 }]);
    expect(d?.payments.map((p) => [p.status, p.amountCents, p.paidAmountCents])).toEqual([["failed", 500, 499]]);
  });

  it("returns null for a malformed id and for another tenant's sale", async () => {
    const a = await setup();
    const b = await setup();
    const id = await sold(a.orgId, a.store, "B-1");
    expect(await withOrg(a.orgId, (tx) => getSaleDetail(tx, "nope"))).toBeNull();
    expect(await withOrg(b.orgId, (tx) => getSaleDetail(tx, id))).toBeNull();
  });
});

describe("salesToday", () => {
  it("counts paid sales of the current day in the market's own time zone", async () => {
    const { orgId, store } = await setup();
    // America/Sao_Paulo is UTC-3. "now" is 23:00 on Oct 2 there, already Oct 3 in UTC.
    const now = new Date("2026-10-03T02:00:00Z");
    await paid(orgId, store, new Date("2026-10-02T12:00:00Z")); // Oct 2 in Sao Paulo: counts
    await paid(orgId, store, new Date("2026-10-03T01:30:00Z")); // 22:30 Oct 2 in Sao Paulo: counts
    await paid(orgId, store, new Date("2026-10-02T02:30:00Z")); // 23:30 Oct 1 in Sao Paulo: does not
    await sold(orgId, store, "B-1"); // open sale: does not count
    expect(await withOrg(orgId, (tx) => salesToday(tx, now))).toEqual({ totalCents: 1000, count: 2 });
  });

  it("returns zero when nothing was sold", async () => {
    const { orgId } = await setup();
    expect(await withOrg(orgId, (tx) => salesToday(tx, NOW))).toEqual({ totalCents: 0, count: 0 });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- tests/domain/sale-queries.test.ts`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar `src/domain/sale-queries.ts`**

```ts
import { z } from "zod";
import type { Tx } from "@/db/tenant";

export type SaleListRow = {
  id: string;
  marketName: string;
  timezone: string;
  status: string;
  totalCents: number;
  itemCount: number;
  createdAt: Date;
};

export type SaleDetail = {
  id: string;
  marketName: string;
  timezone: string;
  status: string;
  totalCents: number;
  createdAt: Date;
  paidAt: Date | null;
  items: { productName: string; quantity: number; unitPriceCents: number }[];
  payments: {
    id: string;
    status: string;
    provider: string;
    amountCents: number;
    paidAmountCents: number | null;
    createdAt: Date;
  }[];
};

export async function listRecentSales(tx: Tx, limit = 50): Promise<SaleListRow[]> {
  const rows = await tx`
    select s.id, m.name as market_name, m.timezone, s.status, s.total_cents, s.created_at,
      (select coalesce(sum(i.quantity), 0)::int from sale_items i where i.sale_id = s.id) as item_count
    from sales s join markets m on m.id = s.market_id
    where exists (select 1 from sale_items i where i.sale_id = s.id)
    order by s.created_at desc limit ${limit}`;
  return rows.map((r) => ({
    id: r.id as string,
    marketName: r.market_name as string,
    timezone: r.timezone as string,
    status: r.status as string,
    totalCents: r.total_cents as number,
    itemCount: r.item_count as number,
    createdAt: r.created_at as Date,
  }));
}

export async function getSaleDetail(tx: Tx, saleId: string): Promise<SaleDetail | null> {
  if (!z.string().uuid().safeParse(saleId).success) return null;
  const [s] = await tx`
    select s.id, m.name as market_name, m.timezone, s.status, s.total_cents, s.created_at, s.paid_at
    from sales s join markets m on m.id = s.market_id where s.id = ${saleId}`;
  if (!s) return null;
  const items = await tx`
    select product_name, quantity, unit_price_cents from sale_items
    where sale_id = ${saleId} order by product_name, id`;
  const payments = await tx`
    select id, status, provider, amount_cents, (webhook_payload->>'paidAmountCents')::int as paid_amount_cents, created_at
    from payments where sale_id = ${saleId} order by created_at, id`;
  return {
    id: s.id as string,
    marketName: s.market_name as string,
    timezone: s.timezone as string,
    status: s.status as string,
    totalCents: s.total_cents as number,
    createdAt: s.created_at as Date,
    paidAt: (s.paid_at as Date | null) ?? null,
    items: items.map((i) => ({
      productName: i.product_name as string,
      quantity: i.quantity as number,
      unitPriceCents: i.unit_price_cents as number,
    })),
    payments: payments.map((p) => ({
      id: p.id as string,
      status: p.status as string,
      provider: p.provider as string,
      amountCents: p.amount_cents as number,
      paidAmountCents: (p.paid_amount_cents as number | null) ?? null,
      createdAt: p.created_at as Date,
    })),
  };
}

/** Paid sales whose paid_at falls on today's date in each market's own time zone. */
export async function salesToday(tx: Tx, now: Date = new Date()): Promise<{ totalCents: number; count: number }> {
  const [r] = await tx`
    select coalesce(sum(s.total_cents), 0)::bigint as total, count(*)::int as n
    from sales s join markets m on m.id = s.market_id
    where s.status = 'paid'
      and (s.paid_at at time zone m.timezone)::date = (${now}::timestamptz at time zone m.timezone)::date`;
  return { totalCents: Number(r.total), count: r.n as number };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -- tests/domain/sale-queries.test.ts`
Expected: PASS.

- [ ] **Step 5: Criar `src/lib/labels.ts`**

```ts
export const STATUS_LABEL: Record<string, string> = {
  open: "Em andamento",
  awaiting_payment: "Aguardando pagamento",
  paid: "Paga",
  cancelled: "Cancelada",
  expired: "Expirada",
};

export const PAYMENT_LABEL: Record<string, string> = {
  pending: "Pendente",
  confirmed: "Confirmado",
  expired: "Expirado",
  failed: "Falhou",
};
```

- [ ] **Step 6: Totens: actions, formulário e página**

`src/app/o/[orgId]/terminals/actions.ts`:

```ts
"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { redirectOnAppError } from "@/app/action-utils";
import { requireOrg } from "@/auth/guard";
import { withOrg } from "@/db/tenant";
import { createTerminal, revokeTerminal } from "@/domain/terminals";
import { AppError } from "@/lib/errors";
import { message } from "@/lib/messages";
import { formToObject } from "@/lib/validate";

export type CreateTerminalState = { token?: string; name?: string; error?: string };

/** Returns the plain token in the response: it is shown once and never stored or put in a URL. */
export async function createTerminalAction(
  orgId: string,
  _prev: CreateTerminalState,
  fd: FormData,
): Promise<CreateTerminalState> {
  try {
    await requireOrg(orgId, "terminal:write");
    const raw = formToObject(fd);
    const { token } = await withOrg(orgId, (tx) => createTerminal(tx, orgId, raw));
    revalidatePath(`/o/${orgId}/terminals`);
    return { token, name: raw.name };
  } catch (e) {
    if (e instanceof AppError) return { error: message(e.code) };
    throw e;
  }
}

export async function revokeTerminalAction(orgId: string, terminalId: string) {
  const path = `/o/${orgId}/terminals`;
  try {
    await requireOrg(orgId, "terminal:write");
    await withOrg(orgId, (tx) => revokeTerminal(tx, terminalId));
  } catch (e) {
    redirectOnAppError(e, path);
  }
  redirect(path);
}
```

`src/app/o/[orgId]/terminals/TerminalForm.tsx`:

```tsx
"use client";
import { useActionState } from "react";
import { type CreateTerminalState, createTerminalAction } from "./actions";

export function TerminalForm({ orgId, markets }: { orgId: string; markets: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState<CreateTerminalState, FormData>(
    createTerminalAction.bind(null, orgId),
    {},
  );
  return (
    <section>
      <form action={formAction}>
        <label>
          Nome do totem <input name="name" required minLength={2} maxLength={60} />
        </label>{" "}
        <label>
          Mercado{" "}
          <select name="marketId" required>
            {markets.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>{" "}
        <button type="submit" disabled={pending || markets.length === 0}>
          Cadastrar totem
        </button>
      </form>
      {state.error && <p role="alert">{state.error}</p>}
      {state.token && (
        <div role="status">
          <p>
            Totem <strong>{state.name}</strong> cadastrado. Copie o token agora: ele não será mostrado de novo.
          </p>
          <code style={{ wordBreak: "break-all" }}>{state.token}</code>
        </div>
      )}
    </section>
  );
}
```

`src/app/o/[orgId]/terminals/page.tsx`:

```tsx
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
```

- [ ] **Step 7: Vendas: lista e detalhe**

`src/app/o/[orgId]/sales/page.tsx`:

```tsx
import { requireOrgPage } from "@/auth/guard";
import { withOrg } from "@/db/tenant";
import { listRecentSales } from "@/domain/sale-queries";
import { STATUS_LABEL } from "@/lib/labels";
import { formatBRL } from "@/lib/money";

export default async function SalesPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  await requireOrgPage(orgId, "sale:read");
  const sales = await withOrg(orgId, (tx) => listRecentSales(tx));
  return (
    <main>
      <h1>Vendas</h1>
      {sales.length === 0 && <p>Nenhuma venda ainda.</p>}
      <table>
        <thead>
          <tr><th>Data</th><th>Mercado</th><th>Itens</th><th>Total</th><th>Situação</th></tr>
        </thead>
        <tbody>
          {sales.map((s) => (
            <tr key={s.id}>
              <td>
                <a href={`/o/${orgId}/sales/${s.id}`}>
                  {s.createdAt.toLocaleString("pt-BR", { timeZone: s.timezone })}
                </a>
              </td>
              <td>{s.marketName}</td>
              <td>{s.itemCount}</td>
              <td>{formatBRL(s.totalCents)}</td>
              <td>{STATUS_LABEL[s.status] ?? s.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
```

`src/app/o/[orgId]/sales/[saleId]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { requireOrgPage } from "@/auth/guard";
import { withOrg } from "@/db/tenant";
import { getSaleDetail } from "@/domain/sale-queries";
import { PAYMENT_LABEL, STATUS_LABEL } from "@/lib/labels";
import { formatBRL } from "@/lib/money";

export default async function SaleDetailPage({ params }: { params: Promise<{ orgId: string; saleId: string }> }) {
  const { orgId, saleId } = await params;
  await requireOrgPage(orgId, "sale:read");
  const sale = await withOrg(orgId, (tx) => getSaleDetail(tx, saleId));
  if (!sale) notFound();
  const when = (d: Date) => d.toLocaleString("pt-BR", { timeZone: sale.timezone });
  return (
    <main>
      <h1>Venda</h1>
      <p>
        {sale.marketName}, {when(sale.createdAt)}: {STATUS_LABEL[sale.status] ?? sale.status},{" "}
        {formatBRL(sale.totalCents)}
        {sale.paidAt && <> (paga em {when(sale.paidAt)})</>}
      </p>
      <h2>Itens</h2>
      <ul>
        {sale.items.map((i, idx) => (
          <li key={idx}>
            {i.quantity} x {i.productName} a {formatBRL(i.unitPriceCents)}
          </li>
        ))}
      </ul>
      <h2>Pagamentos</h2>
      {sale.payments.length === 0 && <p>Nenhum pagamento iniciado.</p>}
      <ul>
        {sale.payments.map((p) => (
          <li key={p.id}>
            {PAYMENT_LABEL[p.status] ?? p.status}: esperado {formatBRL(p.amountCents)}
            {p.paidAmountCents !== null && <>, recebido {formatBRL(p.paidAmountCents)}</>}
            {p.status === "failed" && <strong> (requer atenção: verifique com o provedor)</strong>}
          </li>
        ))}
      </ul>
      <p>
        <a href={`/o/${orgId}/sales`}>Voltar às vendas</a>
      </p>
    </main>
  );
}
```

- [ ] **Step 8: Navegação, dashboard e rótulo de saldo negativo**

Em `src/app/o/[orgId]/layout.tsx`, trocar o trecho do `<nav>` por (os links novos usam `can()`, como o de Equipe):

```tsx
      <nav>
        <a href={base}>Painel</a> <a href={`${base}/markets`}>Mercados</a>{" "}
        <a href={`${base}/products`}>Produtos</a>{" "}
        {can(role, "sale:read") && <a href={`${base}/sales`}>Vendas</a>}{" "}
        {can(role, "terminal:write") && <a href={`${base}/terminals`}>Totens</a>}{" "}
        {can(role, "member:write") && <a href={`${base}/team`}>Equipe</a>}
        <form action={logoutAction} style={{ display: "inline" }}>
          <button type="submit">Sair</button>
        </form>
      </nav>
```

Substituir todo o conteúdo de `src/app/o/[orgId]/page.tsx` por:

```tsx
import { requireOrgPage } from "@/auth/guard";
import { can } from "@/auth/permissions";
import { withOrg } from "@/db/tenant";
import { listMarkets } from "@/domain/markets";
import { salesToday } from "@/domain/sale-queries";
import { listLowStock } from "@/domain/stock";
import { formatBRL } from "@/lib/money";

export default async function Dashboard({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const { role } = await requireOrgPage(orgId, "stock:read");
  const { markets, today } = await withOrg(orgId, async (tx) => ({
    markets: await Promise.all((await listMarkets(tx)).map(async (m) => ({ ...m, low: await listLowStock(tx, m.id) }))),
    today: can(role, "sale:read") ? await salesToday(tx) : null,
  }));
  return (
    <main>
      <h1>Painel</h1>
      {today && (
        <p>
          Vendas hoje: <strong>{formatBRL(today.totalCents)}</strong> ({today.count})
        </p>
      )}
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
```

Em `src/app/o/[orgId]/markets/[marketId]/page.tsx`, trocar a célula do saldo:

```tsx
              <td>{r.balance <= r.minStock ? <strong>{r.balance} (baixo)</strong> : r.balance}</td>
```

por:

```tsx
              <td>
                {r.balance < 0 ? (
                  <strong>{r.balance} (negativo)</strong>
                ) : r.balance <= r.minStock ? (
                  <strong>{r.balance} (baixo)</strong>
                ) : (
                  r.balance
                )}
              </td>
```

- [ ] **Step 9: Rodar tudo**

Run: `npm test && npm run typecheck`
Expected: PASS e typecheck sem erros.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: add owner panel for terminals, sales and today's total"
```

---

### Task 11: Documentação e verificação final

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: tudo das Tarefas 1 a 10.

- [ ] **Step 1: Atualizar o `README.md`**

Acrescentar, depois da seção "Rodar localmente" (e depois de `.env.example` já ter as três variáveis novas da Tarefa 4), uma seção:

```markdown
## Totem (fase 2)

1. No painel, em **Totens**, cadastre um totem para o mercado e copie o token (ele aparece uma vez).
2. No navegador do totem, abra `/pdv` e cole o token. Cadastre antes produtos com código de barras e coloque-os à venda no mercado.
3. Escaneie (o leitor funciona como teclado) e toque em **Pagar com Pix**.
4. Em desenvolvimento o Pix é simulado. Para "pagar" a cobrança mostrada no QR, use o identificador depois de `FAKEPIX|` do código copia e cola:
   `curl -X POST http://localhost:3000/api/dev/fake-pix/<identificador>/pay`
5. Variáveis: `PIX_PROVIDER=fake`, `FAKE_PIX_SECRET` (assinatura do webhook simulado) e `RECONCILE_SECRET` (rota `POST /api/internal/reconcile`, que será agendada na fase 3).

O adaptador `fake` e a rota de pagamento simulado recusam funcionar com `NODE_ENV=production`.
```

- [ ] **Step 2: Suíte completa, tipos e build**

Run: `npm test && npm run typecheck && npm run build` (para o build, o `.env` deve existir; `next build` valida as variáveis do banco na importação).
Expected: todos os testes PASS, typecheck sem erros e build concluído. Se o build reescrever `tsconfig.json` ou criar `next-env.d.ts`, não os inclua no commit.

- [ ] **Step 3: Roteiro HTTP autenticado (substitui o navegador para o que dá para verificar por `curl`)**

Com `docker compose up -d`, `.env` completo, `npm run db:migrate` e `npm run dev -- -p 3457` em segundo plano. Crie os dados com um script descartável FORA do repositório (por exemplo na pasta de rascunho da sessão; apague-o depois). Ele deve fechar os dois pools no fim, senão o processo não termina:

```ts
import { addMember, login, signUp } from "/CAMINHO/DO/REPO/src/auth/service";
import { adminSql, appSql } from "/CAMINHO/DO/REPO/src/db/client";
import { withOrg } from "/CAMINHO/DO/REPO/src/db/tenant";
import { createMarket } from "/CAMINHO/DO/REPO/src/domain/markets";
import { setMarketProduct } from "/CAMINHO/DO/REPO/src/domain/market-products";
import { createProduct } from "/CAMINHO/DO/REPO/src/domain/products";
import { createTerminal } from "/CAMINHO/DO/REPO/src/domain/terminals";

(async () => {
  const s = Date.now();
  const owner = await signUp({ email: `ana${s}@x.com`, password: "senha-forte-1", orgName: "Mercados Ana" });
  const market = await withOrg(owner.orgId, (tx) => createMarket(tx, owner.orgId, { name: "Loja Bloco 1" }));
  const product = await withOrg(owner.orgId, (tx) =>
    createProduct(tx, owner.orgId, { name: "Água 500ml", barcodes: ["7891000100103"] }),
  );
  await withOrg(owner.orgId, (tx) =>
    setMarketProduct(tx, owner.orgId, { marketId: market.id, productId: product.id, priceCents: 590, minStock: 5 }),
  );
  const term = await withOrg(owner.orgId, (tx) =>
    createTerminal(tx, owner.orgId, { marketId: market.id, name: "Totem 1" }),
  );
  await addMember(owner.orgId, { email: `rep${s}@x.com`, password: "senha-rep-123", role: "restocker" });
  const rep = await login({ email: `rep${s}@x.com`, password: "senha-rep-123" });
  const stranger = await signUp({ email: `bia${s}@x.com`, password: "senha-bia-123", orgName: "Bia" });
  console.log(JSON.stringify({ org: owner.orgId, market: market.id, terminal: term.token, owner: owner.token, rep: rep.token, stranger: stranger.token }));
  await adminSql.end();
  await appSql.end();
})();
```

Executar com `npx tsx --env-file=.env <script>`. Depois, com `curl` (substituindo os valores impressos), conferir e registrar o comando e a saída crua de cada item:

1. `POST /api/pdv/sales/items` com `Authorization: Bearer <terminal>` e `{"barcode":"7891000100103"}` retorna 200 com `status: "open"` e `totalCents: 590`. Guarde o `id` da venda.
2. `POST /api/pdv/sales/<id>/pay` retorna 200 com `status: "awaiting_payment"` e `payment.qrPayload` começando com `FAKEPIX|`. Guarde o identificador depois do primeiro `|`.
3. `POST /api/dev/fake-pix/<identificador>/pay` retorna `{"result":"confirmed"}`; repetir a chamada retorna `{"result":"already_confirmed"}`.
4. `GET /api/pdv/sales/<id>` retorna `status: "paid"`.
5. Painel com o cookie `m77_session=<owner>`: `GET /o/<org>/sales` retorna 200 e contém "Paga"; `GET /o/<org>/` contém "Vendas hoje"; `GET /o/<org>/markets/<market>` contém "(negativo)" (a venda baixou 1 unidade de um estoque zerado); `GET /o/<org>/terminals` retorna 200.
6. Com o cookie do repositor (`<rep>`): `GET /o/<org>/sales` e `GET /o/<org>/terminals` retornam 404. Com o cookie do estranho (`<stranger>`): `GET /o/<org>/sales` retorna 404 e a resposta não contém "Mercados Ana".
7. Entradas ruins nunca dão 500: `GET /api/pdv/sales/nope` com o token do totem retorna 404; `POST /api/pdv/sales/items` com corpo `{` retorna 400; sem o cabeçalho `Authorization` retorna 401.
8. Reiniciar o servidor e repetir o `GET /api/pdv/sales/<id>` e `GET /o/<org>/sales` do dono: continuam 200 (o estado fica no banco).

Encerrar o servidor por completo (`pkill -f "next dev"`) e conferir que nada ficou rodando (`pgrep -fl "next|tsx"` vazio) e que `git status` está limpo.

- [ ] **Step 4: Roteiro manual no navegador (feito pelo dono do projeto; o implementador não tem navegador)**

1. Painel em **Totens**: cadastrar um totem e copiar o token.
2. Em outra aba, abrir `/pdv` e colar o token: aparece "Bem-vindo, escaneie um produto".
3. Digitar o código de barras do produto e Enter (ou usar o leitor): o carrinho aparece; testar mais, menos e cancelar.
4. **Pagar com Pix**: aparece o QR com contagem regressiva. Rodar o `curl` da seção "Totem" do README com o identificador do código: a tela vai a "Obrigado!" e volta à inicial.
5. Esperar o QR expirar (3 minutos) sem pagar: aparece o carrinho com "O QR expirou"; **Pagar com Pix** gera um QR novo.
6. Derrubar o servidor com o carrinho aberto: aparece "Totem indisponível" e a tela volta sozinha quando o servidor volta.
7. No painel: **Vendas** mostra a venda paga com o pagamento; o **Painel** mostra "Vendas hoje"; o mercado mostra "(negativo)" quando passou do estoque; **Totens**, revogar o totem faz o `/pdv` mostrar "Totem desativado".

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: document phase 2 totem setup and fake Pix"
```

---

## Auto-revisão

**Cobertura da spec (fase 2):**
- Seção 3, modelo de dados: `terminals`, `sales`, `sale_items`, `payments`, `stock_movements.sale_id`, índices únicos, RLS, grants (Tarefa 1).
- Seção 4, máquina de estados: caps, congelamento de total, QR de 3 min, carrinho de 5 min, `confirmPayment` em qualquer estado exceto `cancelled`, valor divergente, `refreshSale` com `now` e intervalo de 10 s (Tarefas 5, 6 e 7). Reconciliação por cron: `reconcilePending` e a rota protegida por segredo (Tarefas 7 e 8); o agendamento fica na fase 3, como a spec diz.
- Seção 5, camada de pagamento: interface, adaptador `fake` com HMAC e trava de produção, registro, webhook com 401, 200 e idempotência, suíte de contrato (Tarefas 4 e 7). Acréscimo deste plano: o registro rejeita nomes como `constructor` (o nome vem de uma URL).
- Seção 6, API e PDV: autenticação por token, as cinco rotas mais `ping`, tela com leitor, QR, offline, revogado e manifesto, sem service worker (Tarefas 3, 8 e 9). Acréscimos deste plano: a rota `GET /api/pdv/ping` (valida o token na primeira abertura e detecta a volta da rede) e a mensagem `quantity_limit`, para o centésimo escaneamento.
- Seção 7, painel: `terminal:write` e `sale:read`, páginas de totens, vendas, detalhe, linha "Vendas hoje" por fuso do mercado, rótulo "negativo", navegação (Tarefas 2 e 10).
- Seção 9, testes: todos os itens têm teste nas tarefas acima; o roteiro manual e o roteiro HTTP estão na Tarefa 11. Um ponto não é automatizável aqui: a interface do PDV (React no navegador) é verificada só por typecheck, smoke de `200` e roteiro manual, porque o projeto não tem testes de componente.

**Varredura de placeholders:** nenhuma etapa usa "TBD", "TODO", "similar à Tarefa N" nem descreve código sem mostrá-lo. A única referência indireta é o script descartável da Tarefa 11, que está completo e usa um caminho de repositório a preencher.

**Consistência de tipos e nomes:** `TerminalCtx` (`{ terminalId; marketId }`) é o tipo de `term` em `lockSale`, `addItemByBarcode`, `setItemQuantity`, `cancelSale`, `startPayment` e `refreshSale`, e `seedStore` devolve um objeto compatível. `SaleView` vem de `getSaleView` e é o JSON das rotas e o estado da tela. `confirmPayment(tx, paymentId, paidAmountCents, event, now)` tem a mesma assinatura em `payments.ts`, `refresh.ts`, `webhook.ts` e nos testes; `startPayment(tx, orgId, term, saleId, provider, now)` e `refreshSale(tx, term, saleId, provider, now)` também. `payments.provider` guarda `provider.name`, que o webhook usa na busca. O estado `ConfirmResult` (`confirmed`, `already_confirmed`, `rejected`) é o `result` do webhook.

**Decisões do plano que refinam a spec (para você conferir):**
- `terminal_revoked` é distinto de `unauthorized` (o totem sabe que foi desativado); ambos respondem 401.
- `confirmPayment` também rejeita (pagamento `failed`, visível no detalhe da venda) um segundo pagamento para uma venda já paga, e um pagamento para venda `cancelled`. A spec já cobre o segundo caso apenas por analogia, o primeiro explicitamente.
- A transição `open` para `expired` feita por `lockSale` é desfeita se quem chamou lançar erro; leituras (`refreshSale`) a persistem. O efeito é só que a expiração é regravada no próximo acesso.
- O adaptador real pode falhar na hora de iniciar o pagamento com `provider_unavailable` (503); quando o provedor cai durante a espera, a venda não trava: um QR velho expira mesmo sem resposta do provedor, e um pagamento que ainda chegar depois é aceito.
