# Fase 5A: Lote e validade - Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O dono controla a validade dos perecíveis: cada entrada informa a validade, a venda baixa o lote que vence primeiro (FEFO), o painel avisa o que vence e o que venceu, e o totem recusa um produto cujo saldo inteiro está vencido.

**Architecture:** Monólito Next.js sobre as fases 1 a 4. O lote é uma dimensão do livro-razão: tabela nova `stock_lots` (um lote por produto no mercado e data) e coluna `stock_movements.lot_id`; o saldo de um lote é a soma dos movimentos dele. A lógica fica em `src/domain/lots.ts` (alocação FEFO, alertas, bloqueio) e é chamada por `recordMovement` (entrada, perda, ajuste), por `confirmPayment` (baixa da venda) e por `addItemByBarcode` (bloqueio). Produto sem controle segue exatamente o caminho de hoje.

**Tech Stack:** Next.js 15, React 19, TypeScript, Postgres 16, `postgres` (postgres.js), `zod`, `vitest`, `tsx` (todos já instalados). Nenhuma dependência nova.

**Spec:** `docs/superpowers/specs/2026-10-03-fase-5a-lote-validade-design.md` (spec geral: `docs/superpowers/specs/2026-10-01-market77-design.md`)

## Global Constraints

- Stack: Next.js + TypeScript, Postgres com Row Level Security; migrations em SQL puro, sem ORM. Nenhuma dependência nova. Só a migration `0006_lots.sql` muda o banco.
- Todo acesso a dados de negócio passa por `withOrg()`. O `adminSql` aparece só em testes.
- O saldo nunca é editado: o livro-razão `stock_movements` continua só com `SELECT` e `INSERT` para o papel da aplicação, e `stock_lots` também (sem `UPDATE` nem `DELETE`). O saldo do produto é a soma de todos os movimentos; o saldo de um lote é a soma dos movimentos com aquele `lot_id`; movimentos sem lote (`lot_id` nulo) são o "saldo sem lote".
- Validade é opcional por produto no mercado (`market_products.tracks_expiry`, padrão falso). Sem controle, `expiresOn` e `lotId` são ignorados e nada muda em relação às fases anteriores.
- Um lote por produto no mercado e data (`unique (market_product_id, expires_on)`). Uma entrada na mesma data soma no lote existente.
- Dia de validade é a data civil em `America/Sao_Paulo`: um lote vence quando `expires_on` é anterior a hoje nesse fuso (no dia indicado ele ainda vale). Janela de alerta fixa de 7 dias (`EXPIRY_WARN_DAYS = 7`).
- FEFO: a baixa consome os lotes com saldo positivo por `expires_on` crescente (vencidos incluídos); o que sobrar vai sem lote (`lot_id` nulo). O saldo pode ficar negativo, como hoje.
- A ordem de locks é sempre: venda, pagamento, linhas de `market_products` dos produtos com controle (em ordem de id).
- Bloqueio no totem: só quando o produto controla validade, o saldo em lotes vencidos é positivo e o saldo válido (lotes não vencidos mais o saldo sem lote) é zero ou menor. Erro `product_expired`, HTTP 404, mensagem "Produto vencido. Procure o atendimento." Item já no carrinho nunca é reavaliado e pagamento confirmado nunca é bloqueado.
- Interface em português do Brasil. Nenhum emoji em código, commits ou arquivos.
- Comportamento de Pix, cartão e todos os testes existentes continuam como estão.
- Fora desta fase: NFC-e (fase 5B), janela de alerta configurável, e-mail ou push de vencimento, relatório de perdas por validade, mover lote entre mercados.

## Review Focus

1. Duas confirmações simultâneas do mesmo produto: nenhum lote fica negativo enquanto outro tem saldo, e o saldo total bate (Tarefa 4).
2. Confirmar duas vezes a mesma venda, ou uma venda que atravessa dois lotes: baixa uma só vez, um movimento por lote (Tarefas 1 e 4).
3. Entrada com data passada, data impossível (`2026-02-30`), `lotId` de outro produto ou de outra organização: 400 ou 404, nenhum lote nem movimento criado (Tarefa 3).
4. Lote que vence hoje ainda vale; o limite do dia é a meia-noite de São Paulo, não UTC (Tarefas 2 e 5).
5. Ligar e desligar o controle de validade: o saldo antigo continua valendo e o produto sem controle segue o caminho antigo, sem lote (Tarefas 3 e 4).
6. Totem: item que já está no carrinho e pagamento confirmado depois que o lote venceu nunca são bloqueados (Tarefas 4 e 5).

---

## Estrutura de arquivos

```
src/db/migrations/0006_lots.sql              # tracks_expiry, stock_lots, lot_id, índice da venda por lote
src/domain/lots.ts                           # novo: datas, lote, FEFO, bloqueio, alertas
src/domain/stock.ts                          # recordMovement com lote; debitSale
src/domain/market-products.ts                # tracksExpiry no cadastro e na listagem
src/domain/payments.ts                       # confirmPayment usa debitSale
src/domain/sales.ts                          # addItemByBarcode bloqueia produto vencido
src/lib/messages.ts, src/pdv/http.ts         # product_expired
src/app/o/[orgId]/markets/[marketId]/page.tsx, actions.ts   # controle, data, lote, seção Validade
src/app/o/[orgId]/page.tsx                   # vencidos por mercado
tests/helpers.ts                             # track, addLot
tests/db/lots-schema.test.ts
tests/domain/lots.test.ts, stock-lots.test.ts, payments-lots.test.ts, sales-expiry.test.ts, expiry-alerts.test.ts
tests/pdv/expiry-handlers.test.ts
README.md
```

---

### Task 1: Migration 0006 e helpers de teste

**Files:**
- Create: `src/db/migrations/0006_lots.sql`
- Create: `tests/db/lots-schema.test.ts`
- Modify: `tests/helpers.ts`

**Interfaces:**
- Consumes: `market_products (id, org_id)` único, `stock_movements`, `sales`.
- Produces: `market_products.tracks_expiry`, tabela `stock_lots (id, org_id, market_product_id, expires_on, received_at)`, `stock_movements.lot_id`; helpers `track(marketProductId)` e `addLot(orgId, marketProductId, expiresOn, quantity)`.

- [ ] **Step 1: Escrever o teste do schema**

Criar `tests/db/lots-schema.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { adminSql } from "@/db/client";
import { withOrg } from "@/db/tenant";
import { addLot, makeOrg, resetDb, seedMarketProduct, seedSale } from "../helpers";

beforeEach(resetDb);

describe("phase 5A schema", () => {
  it("defaults tracks_expiry to false", async () => {
    const orgId = await makeOrg("A");
    const { marketProductId } = await seedMarketProduct(orgId);
    const [row] = await adminSql`select tracks_expiry from market_products where id = ${marketProductId}`;
    expect(row.tracks_expiry).toBe(false);
  });

  it("keeps one lot per product and date", async () => {
    const orgId = await makeOrg("A");
    const { marketProductId } = await seedMarketProduct(orgId);
    await addLot(orgId, marketProductId, "2026-12-01", 0);
    await expect(addLot(orgId, marketProductId, "2026-12-01", 0)).resolves.toBeTruthy(); // helper reuses the lot
    await expect(
      adminSql`insert into stock_lots (org_id, market_product_id, expires_on)
        values (${orgId}, ${marketProductId}, '2026-12-01')`,
    ).rejects.toThrow(/duplicate key/);
  });

  it("only lets a movement point at a lot of the same product", async () => {
    const orgId = await makeOrg("A");
    const a = await seedMarketProduct(orgId);
    const b = await seedMarketProduct(orgId);
    const lot = await addLot(orgId, a.marketProductId, "2026-12-01", 0);
    await expect(
      adminSql`insert into stock_movements (org_id, market_product_id, type, quantity, lot_id)
        values (${orgId}, ${b.marketProductId}, 'in', 1, ${lot})`,
    ).rejects.toThrow(/foreign key/);
  });

  it("lets one sale take a product from two lots, but not twice from the same one", async () => {
    const orgId = await makeOrg("A");
    const { saleId } = await seedSale(orgId);
    const { marketProductId: mp } = await seedMarketProduct(orgId);
    const l1 = await addLot(orgId, mp, "2026-12-01", 0);
    const l2 = await addLot(orgId, mp, "2026-12-10", 0);
    const sale = (lotId: string | null) =>
      adminSql`insert into stock_movements (org_id, market_product_id, type, quantity, sale_id, lot_id)
        values (${orgId}, ${mp}, 'sale', -1, ${saleId}, ${lotId})`;
    await sale(l1);
    await sale(l2);
    await sale(null);
    await expect(sale(l1)).rejects.toThrow(/duplicate key/);
    await expect(sale(null)).rejects.toThrow(/duplicate key/);
  });

  it("isolates lots per tenant and keeps them append-only for the app role", async () => {
    const a = await makeOrg("A");
    const b = await makeOrg("B");
    const { marketProductId } = await seedMarketProduct(a);
    await addLot(a, marketProductId, "2026-12-01", 0);
    expect(await withOrg(b, (tx) => tx`select id from stock_lots`)).toEqual([]);
    expect(await withOrg(a, (tx) => tx`select id from stock_lots`)).toHaveLength(1);
    await expect(withOrg(a, (tx) => tx`update stock_lots set expires_on = '2027-01-01'`)).rejects.toThrow(
      /permission denied/,
    );
    await expect(withOrg(a, (tx) => tx`delete from stock_lots`)).rejects.toThrow(/permission denied/);
  });
});
```

- [ ] **Step 2: Acrescentar os helpers em `tests/helpers.ts`**

Na lista `TABLES`, inserir `"stock_lots"` antes de `"stock_movements"` (a linha vira `"stock_lots", "stock_movements", "market_products", ...`). No fim do arquivo, antes de `codeOf`, acrescentar:

```ts
/** Turns on expiry control for a market product. */
export async function track(marketProductId: string): Promise<void> {
  await adminSql`update market_products set tracks_expiry = true where id = ${marketProductId}`;
}

/** Creates (or reuses) the lot of this date and, when quantity is not zero, books an entry into it. */
export async function addLot(
  orgId: string,
  marketProductId: string,
  expiresOn: string,
  quantity: number,
): Promise<string> {
  const [l] = await adminSql`
    insert into stock_lots (org_id, market_product_id, expires_on)
    values (${orgId}, ${marketProductId}, ${expiresOn})
    on conflict (market_product_id, expires_on) do update set expires_on = excluded.expires_on
    returning id`;
  if (quantity !== 0) {
    await adminSql`
      insert into stock_movements (org_id, market_product_id, type, quantity, lot_id)
      values (${orgId}, ${marketProductId}, 'in', ${quantity}, ${l.id})`;
  }
  return l.id as string;
}
```

- [ ] **Step 3: Rodar o teste e ver falhar**

Run: `npx vitest run tests/db/lots-schema.test.ts`
Expected: FAIL (a coluna `tracks_expiry` e a tabela `stock_lots` não existem).

- [ ] **Step 4: Escrever a migration**

Criar `src/db/migrations/0006_lots.sql`:

```sql
-- Phase 5A: lots and expiry. A lot is a label on ledger movements; its balance is the sum of its movements.
ALTER TABLE market_products ADD COLUMN tracks_expiry boolean NOT NULL DEFAULT false;

CREATE TABLE stock_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  market_product_id uuid NOT NULL,
  expires_on date NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, org_id),
  UNIQUE (id, market_product_id),
  UNIQUE (market_product_id, expires_on),
  FOREIGN KEY (market_product_id, org_id) REFERENCES market_products (id, org_id)
);

ALTER TABLE stock_lots ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON stock_lots
  USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);
GRANT SELECT, INSERT ON stock_lots TO market77_app;

-- A movement may point at a lot, and the lot must belong to the same product.
ALTER TABLE stock_movements ADD COLUMN lot_id uuid;
ALTER TABLE stock_movements
  ADD FOREIGN KEY (lot_id, market_product_id) REFERENCES stock_lots (id, market_product_id);
CREATE INDEX stock_movements_lot_idx ON stock_movements (lot_id) WHERE lot_id IS NOT NULL;

-- A sale takes each product out of each lot at most once (a sale may span several lots).
DROP INDEX stock_movements_sale_item_idx;
CREATE UNIQUE INDEX stock_movements_sale_item_idx
  ON stock_movements (sale_id, market_product_id, (coalesce(lot_id, '00000000-0000-0000-0000-000000000000'::uuid)))
  WHERE type = 'sale' AND sale_id IS NOT NULL;
```

- [ ] **Step 5: Rodar o teste e a suíte**

Run: `npx vitest run tests/db/lots-schema.test.ts && npm test && npm run typecheck`
Expected: PASS; suíte e typecheck sem erros.

- [ ] **Step 6: Commit**

```bash
git add src/db/migrations/0006_lots.sql tests/db/lots-schema.test.ts tests/helpers.ts
git commit -m "feat: add phase 5A schema for lots and expiry"
```

---

### Task 2: Domínio de lotes (datas, lote, FEFO, bloqueio) e `tracksExpiry`

**Files:**
- Create: `src/domain/lots.ts`
- Create: `tests/domain/lots.test.ts`
- Modify: `src/domain/market-products.ts`
- Modify: `tests/domain/market-products.test.ts`

**Interfaces:**
- Consumes: Tarefa 1 (`stock_lots`, `lot_id`, helpers `track` e `addLot`).
- Produces (em `src/domain/lots.ts`):
  - `EXPIRY_WARN_DAYS = 7`
  - `todayBR(now: Date): string` (YYYY-MM-DD em São Paulo), `plusDays(day: string, n: number): string`, `isRealDay(day: string): boolean`, `formatDay(day: string): string` (DD/MM/AAAA)
  - `type LotBalance = { id: string; expiresOn: string; balance: number }`
  - `type Allocation = { lotId: string | null; quantity: number }`
  - `planFefo(lots: LotBalance[], quantity: number): Allocation[]` (pura)
  - `getOrCreateLot(tx, orgId, marketProductId, expiresOn): Promise<string>`
  - `listLotBalances(tx, marketProductId): Promise<LotBalance[]>` (por `expiresOn` crescente)
  - `allocateFefo(tx, marketProductId, quantity): Promise<Allocation[]>`
  - `lockProducts(tx, ids: string[]): Promise<void>`
  - `isFullyExpired(tx, marketProductId, today: string): Promise<boolean>`
- Produces (em `market-products.ts`): `setMarketProduct` aceita `tracksExpiry?: boolean` (omitido preserva o valor); `MarketProductRow.tracksExpiry: boolean`.

- [ ] **Step 1: Escrever os testes do domínio**

Criar `tests/domain/lots.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { adminSql } from "@/db/client";
import { withOrg } from "@/db/tenant";
import {
  allocateFefo,
  getOrCreateLot,
  isFullyExpired,
  isRealDay,
  listLotBalances,
  planFefo,
  plusDays,
  todayBR,
} from "@/domain/lots";
import { addLot, makeOrg, resetDb, seedMarketProduct, track } from "../helpers";

beforeEach(resetDb);

describe("dates", () => {
  it("uses the civil date in Sao Paulo, not UTC", () => {
    expect(todayBR(new Date("2026-10-03T02:59:00Z"))).toBe("2026-10-02");
    expect(todayBR(new Date("2026-10-03T03:00:00Z"))).toBe("2026-10-03");
  });

  it("adds days across month ends and validates real dates", () => {
    expect(plusDays("2026-10-30", 3)).toBe("2026-11-02");
    expect(isRealDay("2026-02-28")).toBe(true);
    expect(isRealDay("2026-02-30")).toBe(false);
    expect(isRealDay("26-02-01")).toBe(false);
  });
});

describe("planFefo", () => {
  const lot = (id: string, balance: number) => ({ id, expiresOn: "2026-12-01", balance });

  it("takes the earliest lot first and spans lots", () => {
    expect(planFefo([lot("a", 5)], 3)).toEqual([{ lotId: "a", quantity: 3 }]);
    expect(planFefo([lot("a", 2), lot("b", 5)], 4)).toEqual([
      { lotId: "a", quantity: 2 },
      { lotId: "b", quantity: 2 },
    ]);
    expect(planFefo([lot("a", 3)], 3)).toEqual([{ lotId: "a", quantity: 3 }]);
  });

  it("sends the shortfall to no lot and skips empty or negative lots", () => {
    expect(planFefo([lot("a", 2)], 5)).toEqual([
      { lotId: "a", quantity: 2 },
      { lotId: null, quantity: 3 },
    ]);
    expect(planFefo([], 4)).toEqual([{ lotId: null, quantity: 4 }]);
    expect(planFefo([lot("a", 0), lot("b", -2), lot("c", 5)], 2)).toEqual([{ lotId: "c", quantity: 2 }]);
    expect(planFefo([lot("a", 2)], 0)).toEqual([]);
  });
});

describe("lots in the database", () => {
  async function tracked() {
    const orgId = await makeOrg("A");
    const s = await seedMarketProduct(orgId);
    await track(s.marketProductId);
    return { orgId, mp: s.marketProductId };
  }

  it("reuses the lot of the same date and creates another for a new date", async () => {
    const { orgId, mp } = await tracked();
    const a = await withOrg(orgId, (tx) => getOrCreateLot(tx, orgId, mp, "2026-12-01"));
    const b = await withOrg(orgId, (tx) => getOrCreateLot(tx, orgId, mp, "2026-12-01"));
    const c = await withOrg(orgId, (tx) => getOrCreateLot(tx, orgId, mp, "2026-12-02"));
    expect(b).toBe(a);
    expect(c).not.toBe(a);
  });

  it("lists lot balances by expiry and allocates from the earliest", async () => {
    const { orgId, mp } = await tracked();
    await addLot(orgId, mp, "2026-12-20", 5);
    await addLot(orgId, mp, "2026-12-10", 2);
    const lots = await withOrg(orgId, (tx) => listLotBalances(tx, mp));
    expect(lots.map((l) => [l.expiresOn, l.balance])).toEqual([
      ["2026-12-10", 2],
      ["2026-12-20", 5],
    ]);
    const plan = await withOrg(orgId, (tx) => allocateFefo(tx, mp, 4));
    expect(plan).toEqual([
      { lotId: lots[0].id, quantity: 2 },
      { lotId: lots[1].id, quantity: 2 },
    ]);
  });

  it("counts a product as fully expired only when valid stock is gone", async () => {
    const { orgId, mp } = await tracked();
    const today = "2026-10-03";
    const check = () => withOrg(orgId, (tx) => isFullyExpired(tx, mp, today));
    expect(await check()).toBe(false); // no lots at all
    await addLot(orgId, mp, "2026-10-02", 3); // expired yesterday
    expect(await check()).toBe(true);
    await addLot(orgId, mp, "2026-10-03", 1); // valid through today
    expect(await check()).toBe(false);
    await adminSql`insert into stock_movements (org_id, market_product_id, type, quantity)
      values (${orgId}, ${mp}, 'loss', -1)`; // booked without a lot
    expect(await check()).toBe(true); // valid = 1 (today's lot) + (-1) (no lot) = 0, expired = 3
  });
});
```

Em `tests/domain/market-products.test.ts`, acrescentar dentro do `describe` principal (ajuste os imports existentes se faltar `listMarketProducts` ou `setMarketProduct`):

```ts
  it("keeps tracksExpiry when an update omits it and changes it when given", async () => {
    const a = await makeOrg("A");
    const { marketId, productId } = await seedMarketProduct(a);
    const set = (extra: object) =>
      withOrg(a, (tx) => setMarketProduct(tx, a, { marketId, productId, priceCents: 500, ...extra }));
    const read = async () => (await withOrg(a, (tx) => listMarketProducts(tx, marketId)))[0].tracksExpiry;
    expect(await read()).toBe(false);
    await set({ tracksExpiry: true });
    expect(await read()).toBe(true);
    await set({ priceCents: 600 });
    expect(await read()).toBe(true);
    await set({ tracksExpiry: false });
    expect(await read()).toBe(false);
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/domain/lots.test.ts tests/domain/market-products.test.ts`
Expected: FAIL (`@/domain/lots` não existe; `tracksExpiry` não existe).

- [ ] **Step 3: Escrever `src/domain/lots.ts`**

```ts
import type { Tx } from "@/db/tenant";

export const EXPIRY_WARN_DAYS = 7;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Civil date (YYYY-MM-DD) in Sao Paulo; en-CA formats in ISO order. */
export function todayBR(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function plusDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function isRealDay(day: string): boolean {
  if (!DAY.test(day)) return false;
  const d = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === day;
}

/** 2026-10-03 -> 03/10/2026 */
export function formatDay(day: string): string {
  return day.split("-").reverse().join("/");
}

export type LotBalance = { id: string; expiresOn: string; balance: number };
export type Allocation = { lotId: string | null; quantity: number };

/**
 * First-expired-first-out: lots arrive ordered by expiry. Whatever the lots cannot cover goes to
 * no lot, which is also where the old unlotted balance lives, so one bucket covers both.
 */
export function planFefo(lots: LotBalance[], quantity: number): Allocation[] {
  const out: Allocation[] = [];
  let left = quantity;
  for (const l of lots) {
    if (left === 0) break;
    if (l.balance <= 0) continue;
    const take = Math.min(l.balance, left);
    out.push({ lotId: l.id, quantity: take });
    left -= take;
  }
  if (left > 0) out.push({ lotId: null, quantity: left });
  return out;
}

export async function getOrCreateLot(
  tx: Tx,
  orgId: string,
  marketProductId: string,
  expiresOn: string,
): Promise<string> {
  await tx`
    insert into stock_lots (org_id, market_product_id, expires_on)
    values (${orgId}, ${marketProductId}, ${expiresOn})
    on conflict (market_product_id, expires_on) do nothing`;
  const [l] = await tx`
    select id from stock_lots where market_product_id = ${marketProductId} and expires_on = ${expiresOn}`;
  return l.id as string;
}

export async function listLotBalances(tx: Tx, marketProductId: string): Promise<LotBalance[]> {
  const rows = await tx`
    select l.id, l.expires_on::text as expires_on, coalesce(sum(s.quantity), 0)::bigint as balance
    from stock_lots l left join stock_movements s on s.lot_id = l.id
    where l.market_product_id = ${marketProductId}
    group by l.id, l.expires_on, l.received_at
    order by l.expires_on, l.received_at`;
  return rows.map((r) => ({ id: r.id as string, expiresOn: r.expires_on as string, balance: Number(r.balance) }));
}

export async function allocateFefo(tx: Tx, marketProductId: string, quantity: number): Promise<Allocation[]> {
  return planFefo(await listLotBalances(tx, marketProductId), quantity);
}

/**
 * Serializes work on the stock of these products. Callers lock in this one order (sale, payment,
 * then products by id) so two confirmations never read the same lot balance or deadlock.
 */
export async function lockProducts(tx: Tx, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await tx`select id from market_products where id in ${tx(ids)} order by id for update`;
}

/** True when the product has stock in expired lots and nothing valid left (lots not expired, or no lot). */
export async function isFullyExpired(tx: Tx, marketProductId: string, today: string): Promise<boolean> {
  const [r] = await tx`
    select
      coalesce(sum(s.quantity) filter (where l.id is not null and l.expires_on < ${today}), 0)::bigint as expired,
      coalesce(sum(s.quantity) filter (where l.id is null or l.expires_on >= ${today}), 0)::bigint as valid
    from stock_movements s left join stock_lots l on l.id = s.lot_id
    where s.market_product_id = ${marketProductId}`;
  return Number(r.expired) > 0 && Number(r.valid) <= 0;
}
```

- [ ] **Step 4: Atualizar `src/domain/market-products.ts`**

Em `Input`, acrescentar `tracksExpiry: z.boolean().optional(),`. Em `MarketProductRow`, acrescentar `tracksExpiry: boolean;` depois de `active`. Trocar o insert de `setMarketProduct` por:

```ts
    const [row] = await tx`
      insert into market_products (org_id, market_id, product_id, price_cents, min_stock, active, tracks_expiry)
      values (${orgId}, ${i.marketId}, ${i.productId}, ${i.priceCents}, ${i.minStock}, ${i.active}, ${i.tracksExpiry ?? false})
      on conflict (market_id, product_id) do update
        set price_cents = excluded.price_cents, min_stock = excluded.min_stock, active = excluded.active,
            tracks_expiry = coalesce(${i.tracksExpiry ?? null}::boolean, market_products.tracks_expiry)
      returning id`;
```

Em `listMarketProducts`, acrescentar `mp.tracks_expiry` ao `select` (depois de `mp.active`) e `tracksExpiry: r.tracks_expiry as boolean,` ao objeto mapeado (depois de `active`).

- [ ] **Step 5: Rodar os testes e a suíte**

Run: `npx vitest run tests/domain/lots.test.ts tests/domain/market-products.test.ts && npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/domain/lots.ts src/domain/market-products.ts tests/domain/lots.test.ts tests/domain/market-products.test.ts
git commit -m "feat: add lot domain with FEFO planning and expiry control flag"
```

---

### Task 3: Entrada, perda e ajuste com lote (`recordMovement`)

**Files:**
- Modify: `src/domain/stock.ts`
- Create: `tests/domain/stock-lots.test.ts`

**Interfaces:**
- Consumes: Tarefa 2 (`getOrCreateLot`, `allocateFefo`, `lockProducts`, `isRealDay`, `todayBR`, `Allocation`).
- Produces: `recordMovement(tx, orgId, userId, raw, now = new Date())` aceita `expiresOn?: string` (YYYY-MM-DD) e `lotId?: string`; retorno continua `{ id, delta }` (`id` do primeiro movimento gravado).

Regras para produto com controle:
- `in` e `adjustment` positivo exigem `expiresOn` real, hoje ou depois (`invalid_input` caso contrário), e gravam no lote da data.
- `sale`, `loss` e `adjustment` negativo: com `lotId`, baixam esse lote (precisa ser do produto, senão `not_found`); sem `lotId`, usam FEFO e podem gerar mais de um movimento.
- Produto sem controle: igual a hoje (`expiresOn` e `lotId` ignorados, sem lote).

- [ ] **Step 1: Escrever os testes**

Criar `tests/domain/stock-lots.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { adminSql } from "@/db/client";
import { withOrg } from "@/db/tenant";
import { listLotBalances } from "@/domain/lots";
import { getBalance, recordMovement } from "@/domain/stock";
import { addLot, codeOf, makeOrg, resetDb, seedMarketProduct, track } from "../helpers";

beforeEach(resetDb);

const NOW = new Date("2026-10-03T15:00:00Z"); // 2026-10-03 in Sao Paulo

async function tracked() {
  const orgId = await makeOrg("A");
  const s = await seedMarketProduct(orgId);
  await track(s.marketProductId);
  return { orgId, mp: s.marketProductId };
}
const move = (orgId: string, mp: string, type: string, quantity: number, extra: object = {}) =>
  withOrg(orgId, (tx) => recordMovement(tx, orgId, null, { marketProductId: mp, type, quantity, ...extra }, NOW));
const lots = (orgId: string, mp: string) => withOrg(orgId, (tx) => listLotBalances(tx, mp));
const rows = (mp: string) =>
  adminSql`select type, quantity, lot_id from stock_movements where market_product_id = ${mp} order by quantity, id`;

describe("entries into a tracked product", () => {
  it("requires a real expiry that is today or later", async () => {
    const { orgId, mp } = await tracked();
    expect(await codeOf(move(orgId, mp, "in", 5))).toBe("invalid_input");
    expect(await codeOf(move(orgId, mp, "in", 5, { expiresOn: "2026-10-02" }))).toBe("invalid_input");
    expect(await codeOf(move(orgId, mp, "in", 5, { expiresOn: "2026-02-30" }))).toBe("invalid_input");
    expect(await codeOf(move(orgId, mp, "in", 5, { expiresOn: "amanha" }))).toBe("invalid_input");
    expect(await rows(mp)).toHaveLength(0);
    expect((await adminSql`select id from stock_lots`).length).toBe(0);
  });

  it("books into the lot of the date and sums a second entry into the same lot", async () => {
    const { orgId, mp } = await tracked();
    await move(orgId, mp, "in", 5, { expiresOn: "2026-10-03" }); // valid through today
    await move(orgId, mp, "in", 2, { expiresOn: "2026-10-03" });
    await move(orgId, mp, "in", 1, { expiresOn: "2026-11-01" });
    expect((await lots(orgId, mp)).map((l) => [l.expiresOn, l.balance])).toEqual([
      ["2026-10-03", 7],
      ["2026-11-01", 1],
    ]);
  });

  it("requires an expiry for a positive adjustment too", async () => {
    const { orgId, mp } = await tracked();
    expect(await codeOf(move(orgId, mp, "adjustment", 3))).toBe("invalid_input");
    await move(orgId, mp, "adjustment", 3, { expiresOn: "2026-12-01" });
    expect((await lots(orgId, mp))[0].balance).toBe(3);
  });
});

describe("removals from a tracked product", () => {
  it("takes from the earliest lots when no lot is given", async () => {
    const { orgId, mp } = await tracked();
    await addLot(orgId, mp, "2026-10-10", 2);
    await addLot(orgId, mp, "2026-10-20", 5);
    await move(orgId, mp, "loss", 4);
    expect((await lots(orgId, mp)).map((l) => l.balance)).toEqual([0, 3]);
    expect(await withOrg(orgId, (tx) => getBalance(tx, mp))).toBe(3);
  });

  it("books the shortfall without a lot and lets the balance go negative", async () => {
    const { orgId, mp } = await tracked();
    await addLot(orgId, mp, "2026-10-10", 2);
    await addLot(orgId, mp, "2026-10-20", 5);
    await move(orgId, mp, "loss", 10);
    const out = (await rows(mp)).filter((r) => r.quantity < 0);
    expect(out.map((r) => [r.quantity, r.lot_id === null])).toEqual([
      [-5, false],
      [-3, true],
      [-2, false],
    ]);
    expect(await withOrg(orgId, (tx) => getBalance(tx, mp))).toBe(-3);
  });

  it("takes from the chosen lot, and refuses a lot of another product or an unknown one", async () => {
    const { orgId, mp } = await tracked();
    const other = await seedMarketProduct(orgId);
    await track(other.marketProductId);
    const early = await addLot(orgId, mp, "2026-10-10", 4);
    const late = await addLot(orgId, mp, "2026-10-20", 4);
    const foreign = await addLot(orgId, other.marketProductId, "2026-10-10", 4);
    await move(orgId, mp, "loss", 3, { lotId: late });
    expect((await lots(orgId, mp)).map((l) => [l.id === early, l.balance])).toEqual([
      [true, 4],
      [false, 1],
    ]);
    expect(await codeOf(move(orgId, mp, "loss", 1, { lotId: foreign }))).toBe("not_found");
    expect(await codeOf(move(orgId, mp, "loss", 1, { lotId: "00000000-0000-4000-8000-000000000000" }))).toBe(
      "not_found",
    );
    expect(await codeOf(move(orgId, mp, "loss", 1, { lotId: "nope" }))).toBe("invalid_input");
  });

  it("uses FEFO for a negative adjustment", async () => {
    const { orgId, mp } = await tracked();
    await addLot(orgId, mp, "2026-10-10", 2);
    await addLot(orgId, mp, "2026-10-20", 5);
    await move(orgId, mp, "adjustment", -3);
    expect((await lots(orgId, mp)).map((l) => l.balance)).toEqual([0, 4]);
  });
});

describe("a product without expiry control", () => {
  it("ignores expiresOn and lotId and books no lot", async () => {
    const orgId = await makeOrg("A");
    const { marketProductId: mp } = await seedMarketProduct(orgId);
    await move(orgId, mp, "in", 5, { expiresOn: "2020-01-01" });
    await move(orgId, mp, "loss", 1, { lotId: "00000000-0000-4000-8000-000000000000" });
    expect((await rows(mp)).map((r) => [r.quantity, r.lot_id])).toEqual([
      [-1, null],
      [5, null],
    ]);
    expect((await adminSql`select id from stock_lots`).length).toBe(0);
  });

  it("keeps the old balance as the unlotted balance when control is turned on", async () => {
    const orgId = await makeOrg("A");
    const { marketProductId: mp } = await seedMarketProduct(orgId);
    await move(orgId, mp, "in", 6);
    await track(mp);
    await move(orgId, mp, "in", 2, { expiresOn: "2026-12-01" });
    expect(await withOrg(orgId, (tx) => getBalance(tx, mp))).toBe(8);
    await move(orgId, mp, "loss", 3); // lot first (2), then 1 from the unlotted bucket
    const out = (await rows(mp)).filter((r) => r.quantity < 0);
    expect(out.map((r) => [r.quantity, r.lot_id === null])).toEqual([
      [-2, false],
      [-1, true],
    ]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/domain/stock-lots.test.ts`
Expected: FAIL (entrada sem `expiresOn` não é recusada; nenhum lote é criado).

- [ ] **Step 3: Reescrever `recordMovement` em `src/domain/stock.ts`**

Trocar os imports do topo por:

```ts
import { z } from "zod";
import type { Tx } from "@/db/tenant";
import { AppError, isForeignKeyViolation } from "@/lib/errors";
import { parse } from "@/lib/validate";
import { type Allocation, allocateFefo, getOrCreateLot, isRealDay, lockProducts, todayBR } from "./lots";
import { type MarketProductRow, listMarketProducts } from "./market-products";
```

No `z.object` de `Movement`, depois de `note`, acrescentar:

```ts
    expiresOn: z.string().optional(),
    lotId: z.string().uuid().optional(),
```

Substituir o comentário e a função `recordMovement` inteira por:

```ts
async function insertMovement(
  tx: Tx,
  orgId: string,
  userId: string | null,
  m: { marketProductId: string; type: string; note?: string },
  quantity: number,
  lotId: string | null,
): Promise<string> {
  const [row] = await tx`
    insert into stock_movements (org_id, market_product_id, type, quantity, note, created_by, lot_id)
    values (${orgId}, ${m.marketProductId}, ${m.type}, ${quantity}, ${m.note ?? null}, ${userId}, ${lotId})
    returning id`;
  return row.id as string;
}

/**
 * in/sale/loss take a positive quantity (sign comes from the type);
 * adjustment takes a signed, non-zero quantity. Balance may go negative on purpose:
 * the ledger records what happened, adjustments fix it.
 *
 * A product that tracks expiry books entries into the lot of expiresOn (required, today or later)
 * and removals from lotId, or first-expired-first-out when no lot is given. Other products ignore both.
 */
export async function recordMovement(
  tx: Tx,
  orgId: string,
  userId: string | null,
  raw: unknown,
  now: Date = new Date(),
): Promise<{ id: string; delta: number }> {
  const m = parse(Movement, raw);
  const delta = m.type === "sale" || m.type === "loss" ? -m.quantity : m.quantity;
  try {
    const [mp] = await tx`select tracks_expiry from market_products where id = ${m.marketProductId}`;
    if (!mp) throw new AppError("not_found");
    if (!mp.tracks_expiry) return { id: await insertMovement(tx, orgId, userId, m, delta, null), delta };

    // ponytail: the flag is read before the lock; a flip in that window books this one movement the other way.
    await lockProducts(tx, [m.marketProductId]);
    if (delta > 0) {
      if (!m.expiresOn || !isRealDay(m.expiresOn) || m.expiresOn < todayBR(now)) {
        throw new AppError("invalid_input", "expiresOn must be a real date, today or later");
      }
      const lotId = await getOrCreateLot(tx, orgId, m.marketProductId, m.expiresOn);
      return { id: await insertMovement(tx, orgId, userId, m, delta, lotId), delta };
    }

    let parts: Allocation[];
    if (m.lotId) {
      const [lot] = await tx`select 1 from stock_lots where id = ${m.lotId} and market_product_id = ${m.marketProductId}`;
      if (!lot) throw new AppError("not_found");
      parts = [{ lotId: m.lotId, quantity: -delta }];
    } else {
      parts = await allocateFefo(tx, m.marketProductId, -delta);
    }
    let first = "";
    for (const p of parts) {
      const id = await insertMovement(tx, orgId, userId, m, -p.quantity, p.lotId);
      first ||= id;
    }
    return { id: first, delta };
  } catch (e) {
    if (isForeignKeyViolation(e)) throw new AppError("not_found");
    throw e;
  }
}
```

(`getBalance` e `listLowStock` ficam como estão.)

- [ ] **Step 4: Rodar os testes e a suíte**

Run: `npx vitest run tests/domain/stock-lots.test.ts tests/domain/stock.test.ts && npm test && npm run typecheck`
Expected: PASS (inclui o teste existente de 20 vendas concorrentes de produto sem controle).

- [ ] **Step 5: Commit**

```bash
git add src/domain/stock.ts tests/domain/stock-lots.test.ts
git commit -m "feat: book stock entries and removals by lot for tracked products"
```

---

### Task 4: Baixa da venda por FEFO (`confirmPayment`)

**Files:**
- Modify: `src/domain/stock.ts`
- Modify: `src/domain/payments.ts`
- Create: `tests/domain/payments-lots.test.ts`

**Interfaces:**
- Consumes: Tarefa 2 (`allocateFefo`, `lockProducts`), `confirmPayment(tx, paymentId, paidAmountCents, event, now)` e `startPayment(tx, orgId, term, saleId, provider, now)` existentes.
- Produces: `debitSale(tx: Tx, saleId: string): Promise<void>` em `src/domain/stock.ts`, chamado por `confirmPayment` no lugar do `insert ... select` atual.

- [ ] **Step 1: Escrever os testes**

Criar `tests/domain/payments-lots.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { adminSql } from "@/db/client";
import { withOrg } from "@/db/tenant";
import { listLotBalances } from "@/domain/lots";
import { confirmPayment, startPayment } from "@/domain/payments";
import { addItemByBarcode } from "@/domain/sales";
import { getBalance } from "@/domain/stock";
import { fakeProvider } from "@/payments/fake";
import { addLot, makeOrg, resetDb, seedSellable, seedStore, track } from "../helpers";

beforeEach(resetDb);

const NOW = new Date("2026-10-03T15:00:00Z");
const BARCODE = "7891000100103";

async function shop(tracked = true) {
  const orgId = await makeOrg("A");
  const store = await seedStore(orgId);
  const item = await seedSellable(orgId, store.marketId, { barcode: BARCODE, priceCents: 500 });
  if (tracked) await track(item.marketProductId);
  return { orgId, store, mp: item.marketProductId };
}
type Shop = Awaited<ReturnType<typeof shop>>;

/** An open sale with `units` of the product, payment started. Returns the payment id and total. */
async function checkout(s: Shop, units: number) {
  let sale = await withOrg(s.orgId, (tx) => addItemByBarcode(tx, s.orgId, s.store, { barcode: BARCODE }, NOW));
  for (let i = 1; i < units; i++) {
    sale = await withOrg(s.orgId, (tx) =>
      addItemByBarcode(tx, s.orgId, s.store, { saleId: sale.id, barcode: BARCODE }, NOW),
    );
  }
  await withOrg(s.orgId, (tx) => startPayment(tx, s.orgId, s.store, sale.id, fakeProvider, NOW));
  const [p] = await adminSql`select id from payments where sale_id = ${sale.id}`;
  return { saleId: sale.id as string, paymentId: p.id as string, total: units * 500 };
}
const confirm = (s: Shop, c: { paymentId: string; total: number }, now = NOW) =>
  withOrg(s.orgId, (tx) => confirmPayment(tx, c.paymentId, c.total, { test: true }, now));
const sold = (saleId: string) =>
  adminSql`select quantity, lot_id from stock_movements where sale_id = ${saleId} order by quantity, id`;
const lots = (s: Shop) => withOrg(s.orgId, (tx) => listLotBalances(tx, s.mp));

describe("selling a tracked product", () => {
  it("takes one unit from each lot when the sale spans two lots", async () => {
    const s = await shop();
    await addLot(s.orgId, s.mp, "2026-10-10", 1);
    await addLot(s.orgId, s.mp, "2026-10-20", 5);
    const c = await checkout(s, 2);
    expect(await confirm(s, c)).toBe("confirmed");
    expect((await lots(s)).map((l) => l.balance)).toEqual([0, 4]);
    expect(await sold(c.saleId)).toHaveLength(2);
  });

  it("does not take stock twice when the same payment is confirmed again", async () => {
    const s = await shop();
    await addLot(s.orgId, s.mp, "2026-10-10", 1);
    await addLot(s.orgId, s.mp, "2026-10-20", 5);
    const c = await checkout(s, 2);
    await confirm(s, c);
    expect(await confirm(s, c)).toBe("already_confirmed");
    expect(await sold(c.saleId)).toHaveLength(2);
    expect(await withOrg(s.orgId, (tx) => getBalance(tx, s.mp))).toBe(4);
  });

  it("sells an expired lot first, because the oldest item leaves first", async () => {
    const s = await shop();
    await addLot(s.orgId, s.mp, "2026-10-01", 1); // expired by NOW
    await addLot(s.orgId, s.mp, "2026-10-20", 5);
    const c = await checkout(s, 1);
    await confirm(s, c);
    expect((await lots(s)).map((l) => l.balance)).toEqual([0, 5]);
  });

  it("books the shortfall without a lot and leaves the balance negative", async () => {
    const s = await shop();
    await addLot(s.orgId, s.mp, "2026-10-10", 1);
    const c = await checkout(s, 2);
    await confirm(s, c);
    const parts = await sold(c.saleId);
    expect(parts.map((r) => r.quantity)).toEqual([-1, -1]);
    expect(parts.map((r) => r.lot_id === null).sort()).toEqual([false, true]);
    expect(await withOrg(s.orgId, (tx) => getBalance(tx, s.mp))).toBe(-1);
  });

  it("does not let two concurrent confirmations read the same lot balance", async () => {
    const s = await shop();
    await addLot(s.orgId, s.mp, "2026-10-10", 1);
    await addLot(s.orgId, s.mp, "2026-10-20", 5);
    const one = await checkout(s, 1);
    const two = await checkout(s, 1);
    await Promise.all([confirm(s, one), confirm(s, two)]);
    expect((await lots(s)).map((l) => l.balance)).toEqual([0, 4]);
  });

  it("still confirms after the lots expired", async () => {
    const s = await shop();
    await addLot(s.orgId, s.mp, "2026-10-04", 1);
    const c = await checkout(s, 1);
    const later = new Date("2026-10-20T12:00:00Z");
    expect(await confirm(s, c, later)).toBe("confirmed");
  });
});

describe("selling a product without expiry control", () => {
  it("books a single movement with no lot, as before", async () => {
    const s = await shop(false);
    await adminSql`insert into stock_movements (org_id, market_product_id, type, quantity)
      values (${s.orgId}, ${s.mp}, 'in', 5)`;
    const c = await checkout(s, 2);
    await confirm(s, c);
    expect((await sold(c.saleId)).map((r) => [r.quantity, r.lot_id])).toEqual([[-2, null]]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/domain/payments-lots.test.ts`
Expected: FAIL (a baixa atual não usa lotes: um movimento sem lote).

- [ ] **Step 3: Acrescentar `debitSale` em `src/domain/stock.ts`**

```ts
/**
 * Takes a paid sale out of stock: one movement per product, split by lot (first-expired-first-out)
 * for products that track expiry. The unique index on (sale, product, lot) makes a repeat a no-op error.
 */
export async function debitSale(tx: Tx, saleId: string): Promise<void> {
  const items = await tx`
    select org_id, market_product_id, quantity from sale_items where sale_id = ${saleId} order by market_product_id`;
  if (items.length === 0) return;
  const ids = items.map((i) => i.market_product_id as string);
  const tracked = new Set(
    (await tx`select id from market_products where id in ${tx(ids)} and tracks_expiry`).map((r) => r.id as string),
  );
  await lockProducts(tx, [...tracked]);
  for (const it of items) {
    const mpId = it.market_product_id as string;
    const parts: Allocation[] = tracked.has(mpId)
      ? await allocateFefo(tx, mpId, it.quantity as number)
      : [{ lotId: null, quantity: it.quantity as number }];
    for (const p of parts) {
      await tx`
        insert into stock_movements (org_id, market_product_id, type, quantity, sale_id, lot_id)
        values (${it.org_id}, ${mpId}, 'sale', ${-p.quantity}, ${saleId}, ${p.lotId})`;
    }
  }
}
```

- [ ] **Step 4: Usar em `confirmPayment` (`src/domain/payments.ts`)**

Acrescentar `import { debitSale } from "./stock";` aos imports e trocar o `insert` de `stock_movements` (o bloco de três linhas logo depois de `update sales set status = 'paid'`) por:

```ts
  await debitSale(tx, sale.id as string);
```

- [ ] **Step 5: Rodar os testes e a suíte**

Run: `npx vitest run tests/domain/payments-lots.test.ts tests/domain/payments.test.ts && npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/domain/stock.ts src/domain/payments.ts tests/domain/payments-lots.test.ts
git commit -m "feat: take sold stock out of the lot that expires first"
```

---

### Task 5: Bloqueio de produto vencido no totem

**Files:**
- Modify: `src/domain/sales.ts`
- Modify: `src/lib/messages.ts`
- Modify: `src/pdv/http.ts`
- Create: `tests/domain/sales-expiry.test.ts`
- Create: `tests/pdv/expiry-handlers.test.ts`

**Interfaces:**
- Consumes: Tarefa 2 (`isFullyExpired`, `todayBR`).
- Produces: `addItemByBarcode` lança `AppError("product_expired")` (404, mensagem em português) para produto com controle, com saldo só em lotes vencidos.

- [ ] **Step 1: Escrever os testes de domínio**

Criar `tests/domain/sales-expiry.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { adminSql } from "@/db/client";
import { withOrg } from "@/db/tenant";
import { addItemByBarcode, setItemQuantity } from "@/domain/sales";
import { addLot, codeOf, makeOrg, resetDb, seedSellable, seedStore, track } from "../helpers";

beforeEach(resetDb);

const NOW = new Date("2026-10-03T15:00:00Z"); // 2026-10-03 in Sao Paulo
const BARCODE = "7891000100103";

async function shop(tracked = true) {
  const orgId = await makeOrg("A");
  const store = await seedStore(orgId);
  const item = await seedSellable(orgId, store.marketId, { barcode: BARCODE });
  if (tracked) await track(item.marketProductId);
  return { orgId, store, mp: item.marketProductId };
}
const scan = (s: Awaited<ReturnType<typeof shop>>, now = NOW) =>
  withOrg(s.orgId, (tx) => addItemByBarcode(tx, s.orgId, s.store, { barcode: BARCODE }, now));

describe("scanning a tracked product", () => {
  it("sells it when there is no lot at all", async () => {
    expect((await scan(await shop())).items).toHaveLength(1);
  });

  it("refuses it when all the stock is in expired lots", async () => {
    const s = await shop();
    await addLot(s.orgId, s.mp, "2026-10-02", 3);
    expect(await codeOf(scan(s))).toBe("product_expired");
    expect((await adminSql`select id from sales`).length).toBe(0);
  });

  it("sells it when a valid lot exists next to an expired one", async () => {
    const s = await shop();
    await addLot(s.orgId, s.mp, "2026-10-02", 3);
    await addLot(s.orgId, s.mp, "2026-10-20", 1);
    expect((await scan(s)).items).toHaveLength(1);
  });

  it("treats a lot that expires today as still valid, and expired from the next day", async () => {
    const s = await shop();
    await addLot(s.orgId, s.mp, "2026-10-03", 3);
    expect((await scan(s)).items).toHaveLength(1);
    expect(await codeOf(scan(s, new Date("2026-10-04T03:00:00Z")))).toBe("product_expired");
  });

  it("uses the Sao Paulo midnight, not UTC, for the day boundary", async () => {
    const s = await shop();
    await addLot(s.orgId, s.mp, "2026-10-03", 3);
    // 2026-10-04T01:00Z is still 2026-10-03 22:00 in Sao Paulo
    expect((await scan(s, new Date("2026-10-04T01:00:00Z"))).items).toHaveLength(1);
  });

  it("sells it when the only stock has no lot", async () => {
    const s = await shop();
    await adminSql`insert into stock_movements (org_id, market_product_id, type, quantity)
      values (${s.orgId}, ${s.mp}, 'in', 4)`;
    expect((await scan(s)).items).toHaveLength(1);
  });

  it("does not block a product that does not track expiry", async () => {
    const s = await shop(false);
    await addLot(s.orgId, s.mp, "2026-10-02", 3);
    expect((await scan(s)).items).toHaveLength(1);
  });

  it("keeps an item that is already in the cart when its lot expires at midnight", async () => {
    const s = await shop();
    await addLot(s.orgId, s.mp, "2026-10-03", 3);
    const before = new Date("2026-10-04T02:58:00Z"); // 23:58 in Sao Paulo, lot still valid
    const after = new Date("2026-10-04T03:01:00Z"); // 00:01 the next day, lot expired
    const first = await scan(s, before);
    const view = await withOrg(s.orgId, (tx) =>
      setItemQuantity(tx, s.store, first.id, { itemId: first.items[0].id, quantity: 2 }, after),
    );
    expect(view.items[0].quantity).toBe(2);
    expect(await codeOf(scan(s, after))).toBe("product_expired");
  });
});
```

- [ ] **Step 2: Escrever o teste do handler HTTP**

Criar `tests/pdv/expiry-handlers.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { withOrg } from "@/db/tenant";
import { createTerminal } from "@/domain/terminals";
import { scanHandler } from "@/pdv/http";
import { addLot, makeOrg, resetDb, seedSellable, seedStore, track } from "../helpers";

beforeEach(resetDb);

const BARCODE = "7891000100103";

describe("scanning an expired product over HTTP", () => {
  it("answers 404 with a Portuguese message and sells again once a valid lot exists", async () => {
    const orgId = await makeOrg("A");
    const store = await seedStore(orgId);
    const item = await seedSellable(orgId, store.marketId, { barcode: BARCODE });
    await track(item.marketProductId);
    await addLot(orgId, item.marketProductId, "2020-01-01", 3);
    const { token } = await withOrg(orgId, (tx) =>
      createTerminal(tx, orgId, { marketId: store.marketId, name: "Totem 1" }),
    );
    const scan = () =>
      scanHandler(
        new Request("http://m77.test/api/pdv/sales/items", {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ barcode: BARCODE }),
        }),
      );
    const blocked = await scan();
    expect([blocked.status, await blocked.json()]).toEqual([
      404,
      { error: "product_expired", message: "Produto vencido. Procure o atendimento." },
    ]);
    await addLot(orgId, item.marketProductId, "2999-01-01", 1);
    expect((await scan()).status).toBe(200);
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest run tests/domain/sales-expiry.test.ts tests/pdv/expiry-handlers.test.ts`
Expected: FAIL (o produto vencido ainda é vendido).

- [ ] **Step 4: Implementar**

Em `src/lib/messages.ts`, depois de `product_inactive`, acrescentar:

```ts
  product_expired: "Produto vencido. Procure o atendimento.",
```

Em `src/pdv/http.ts`, no mapa `STATUS`, depois de `product_inactive: 404,`, acrescentar `product_expired: 404,`.

Em `src/domain/sales.ts`, acrescentar `import { isFullyExpired, todayBR } from "./lots";` aos imports. Em `addItemByBarcode`, trocar a consulta do produto para incluir `mp.tracks_expiry`:

```ts
    select mp.id, mp.price_cents, mp.active, mp.tracks_expiry, p.name
```

e, logo depois da linha `if (!mp.active) throw new AppError("product_inactive");`, acrescentar:

```ts
  if (mp.tracks_expiry && (await isFullyExpired(tx, mp.id as string, todayBR(now)))) {
    throw new AppError("product_expired");
  }
```

- [ ] **Step 5: Rodar os testes e a suíte**

Run: `npx vitest run tests/domain/sales-expiry.test.ts tests/pdv/expiry-handlers.test.ts && npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/domain/sales.ts src/lib/messages.ts src/pdv/http.ts tests/domain/sales-expiry.test.ts tests/pdv/expiry-handlers.test.ts
git commit -m "feat: refuse to sell a product whose whole stock is expired"
```

---

### Task 6: Alertas de validade

**Files:**
- Modify: `src/domain/lots.ts`
- Create: `tests/domain/expiry-alerts.test.ts`

**Interfaces:**
- Consumes: Tarefa 2 (`todayBR`, `plusDays`, `EXPIRY_WARN_DAYS`).
- Produces: `type ExpiryAlert = { lotId: string; marketProductId: string; productName: string; expiresOn: string; quantity: number; status: "expired" | "expiring" }` e `listExpiryAlerts(tx, marketId, now): Promise<ExpiryAlert[]>`, ordenado por validade e nome.

- [ ] **Step 1: Escrever os testes**

Criar `tests/domain/expiry-alerts.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { adminSql } from "@/db/client";
import { withOrg } from "@/db/tenant";
import { listExpiryAlerts } from "@/domain/lots";
import { addLot, makeOrg, resetDb, seedMarketProduct, track } from "../helpers";

beforeEach(resetDb);

const NOW = new Date("2026-10-03T15:00:00Z"); // today 2026-10-03, window ends 2026-10-10

describe("expiry alerts", () => {
  it("lists expired and expiring lots with stock, in date order, and nothing else", async () => {
    const orgId = await makeOrg("A");
    const { marketId, marketProductId: mp } = await seedMarketProduct(orgId);
    await track(mp);
    await addLot(orgId, mp, "2026-10-01", 3); // expired
    await addLot(orgId, mp, "2026-10-08", 4); // expiring
    await addLot(orgId, mp, "2026-10-10", 1); // last day of the window
    await addLot(orgId, mp, "2026-10-11", 9); // outside the window
    const empty = await addLot(orgId, mp, "2026-10-05", 2);
    await adminSql`insert into stock_movements (org_id, market_product_id, type, quantity, lot_id)
      values (${orgId}, ${mp}, 'loss', -2, ${empty})`; // sold out: no alert
    const alerts = await withOrg(orgId, (tx) => listExpiryAlerts(tx, marketId, NOW));
    expect(alerts.map((a) => [a.expiresOn, a.quantity, a.status])).toEqual([
      ["2026-10-01", 3, "expired"],
      ["2026-10-08", 4, "expiring"],
      ["2026-10-10", 1, "expiring"],
    ]);
    expect(alerts[0].productName).toBe("Água");
  });

  it("ignores products that do not track expiry and other markets", async () => {
    const orgId = await makeOrg("A");
    const untracked = await seedMarketProduct(orgId);
    await addLot(orgId, untracked.marketProductId, "2026-10-01", 3);
    const other = await seedMarketProduct(orgId);
    await track(other.marketProductId);
    await addLot(orgId, other.marketProductId, "2026-10-01", 3);
    expect(await withOrg(orgId, (tx) => listExpiryAlerts(tx, untracked.marketId, NOW))).toEqual([]);
    expect(await withOrg(orgId, (tx) => listExpiryAlerts(tx, other.marketId, NOW))).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/domain/expiry-alerts.test.ts`
Expected: FAIL (`listExpiryAlerts` não existe).

- [ ] **Step 3: Implementar em `src/domain/lots.ts`**

Acrescentar ao fim do arquivo:

```ts
export type ExpiryAlert = {
  lotId: string;
  marketProductId: string;
  productName: string;
  expiresOn: string;
  quantity: number;
  status: "expired" | "expiring";
};

/** Lots with stock that already expired or expire within EXPIRY_WARN_DAYS, earliest first. */
export async function listExpiryAlerts(tx: Tx, marketId: string, now: Date): Promise<ExpiryAlert[]> {
  const today = todayBR(now);
  const limit = plusDays(today, EXPIRY_WARN_DAYS);
  const rows = await tx`
    select l.id, l.market_product_id, p.name, l.expires_on::text as expires_on, sum(s.quantity)::bigint as quantity
    from stock_lots l
    join market_products mp on mp.id = l.market_product_id
    join products p on p.id = mp.product_id
    join stock_movements s on s.lot_id = l.id
    where mp.market_id = ${marketId} and mp.tracks_expiry and l.expires_on <= ${limit}
    group by l.id, l.market_product_id, p.name, l.expires_on
    having sum(s.quantity) > 0
    order by l.expires_on, p.name`;
  return rows.map((r) => ({
    lotId: r.id as string,
    marketProductId: r.market_product_id as string,
    productName: r.name as string,
    expiresOn: r.expires_on as string,
    quantity: Number(r.quantity),
    status: (r.expires_on as string) < today ? "expired" : "expiring",
  }));
}
```

- [ ] **Step 4: Rodar os testes e a suíte**

Run: `npx vitest run tests/domain/expiry-alerts.test.ts && npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/lots.ts tests/domain/expiry-alerts.test.ts
git commit -m "feat: list lots that expired or expire within a week"
```

---

### Task 7: Painel do dono (controle, data, lote, seção Validade)

**Files:**
- Modify: `src/app/o/[orgId]/markets/[marketId]/actions.ts`
- Modify: `src/app/o/[orgId]/markets/[marketId]/page.tsx`
- Modify: `src/app/o/[orgId]/page.tsx`

**Interfaces:**
- Consumes: `MarketProductRow.tracksExpiry`, `setMarketProduct({ tracksExpiry })`, `recordMovement({ expiresOn, lotId })`, `listLotBalances`, `listExpiryAlerts`, `formatDay`.
- Produces: interface apenas; a lógica está coberta pelos testes das Tarefas 2 a 6. Verificação: typecheck, build e o roteiro da Tarefa 8.

- [ ] **Step 1: Ações do mercado (`actions.ts`)**

Em `setMarketProductAction`, no objeto passado a `setMarketProduct`, acrescentar `tracksExpiry: raw.tracksExpiry === "on",` depois de `active`. Em `moveStockAction`, no objeto passado a `recordMovement`, acrescentar:

```ts
        expiresOn: raw.expiresOn,
        lotId: raw.lotId,
```

(`formToObject` já descarta campos em branco, então data vazia e lote em branco chegam como `undefined`.)

- [ ] **Step 2: Página do mercado (`page.tsx`)**

Acrescentar aos imports: `import { type LotBalance, formatDay, listExpiryAlerts, listLotBalances } from "@/domain/lots";`.

Trocar o bloco `const { rows, products } = ...` por:

```tsx
  const { rows, products, lots, alerts } = await withOrg(orgId, async (tx) => {
    const rows = await listMarketProducts(tx, marketId);
    const lots = new Map<string, LotBalance[]>();
    for (const r of rows) {
      if (r.tracksExpiry) lots.set(r.id, (await listLotBalances(tx, r.id)).filter((l) => l.balance > 0));
    }
    return {
      rows,
      lots,
      products: await listProducts(tx),
      alerts: await listExpiryAlerts(tx, marketId, new Date()),
    };
  });
```

Na tabela, trocar o cabeçalho para incluir a coluna `<th>Validade</th>` depois de `<th>Ativo</th>`, e a célula correspondente depois de `<td>{r.active ? "sim" : "não"}</td>`:

```tsx
              <td>{r.tracksExpiry ? "controla" : "não"}</td>
```

No formulário de movimentação (dentro de `can(role, "stock:move")`), depois do `<input name="quantity" ... />`, acrescentar:

```tsx
                    {r.tracksExpiry && (
                      <>
                        <label>
                          Validade (entrada) <input name="expiresOn" type="date" />
                        </label>
                        <select name="lotId" defaultValue="">
                          <option value="">Lote: o que vence primeiro</option>
                          {(lots.get(r.id) ?? []).map((l) => (
                            <option key={l.id} value={l.id}>
                              {formatDay(l.expiresOn)} ({l.balance})
                            </option>
                          ))}
                        </select>
                      </>
                    )}
```

No formulário "Adicionar ou atualizar produto neste mercado", depois do campo `Ativo`, acrescentar:

```tsx
          <label>Controla validade <input name="tracksExpiry" type="checkbox" /></label>
```

(Atenção: salvar com a caixa desmarcada desliga o controle, como `Ativo` já funciona.)

Antes do `{can(role, "price:write") && (` final, acrescentar a seção:

```tsx
      <h2>Validade</h2>
      {alerts.length === 0 ? (
        <p>Nenhum lote vencido ou vencendo em 7 dias.</p>
      ) : (
        <table>
          <thead>
            <tr><th>Produto</th><th>Validade</th><th>Quantidade</th><th>Situação</th></tr>
          </thead>
          <tbody>
            {alerts.map((a) => (
              <tr key={a.lotId}>
                <td>{a.productName}</td>
                <td>{formatDay(a.expiresOn)}</td>
                <td>{a.quantity}</td>
                <td>{a.status === "expired" ? <strong>Vencido</strong> : "Vence em breve"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
```

- [ ] **Step 3: Página inicial (`src/app/o/[orgId]/page.tsx`)**

Acrescentar `import { listExpiryAlerts } from "@/domain/lots";`. Trocar o mapeamento de `markets` por:

```tsx
    markets: await Promise.all(
      (await listMarkets(tx)).map(async (m) => ({
        ...m,
        low: await listLowStock(tx, m.id),
        expired: (await listExpiryAlerts(tx, m.id, new Date())).filter((a) => a.status === "expired").length,
      })),
    ),
```

e, depois da linha do estoque baixo dentro do `<li>`, acrescentar:

```tsx
            {m.expired > 0 && <strong> ({m.expired} lote(s) vencido(s))</strong>}
```

- [ ] **Step 4: Verificação**

Run: `npm run typecheck && npm test && npm run build`
Expected: sem erros; o build lista `/o/[orgId]/markets/[marketId]`.

- [ ] **Step 5: Commit**

```bash
git add "src/app/o/[orgId]/markets/[marketId]/actions.ts" "src/app/o/[orgId]/markets/[marketId]/page.tsx" "src/app/o/[orgId]/page.tsx"
git commit -m "feat: control expiry, enter dates and see expiring lots in the owner panel"
```

---

### Task 8: Documentação e verificação final

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: tudo das Tarefas 1 a 7.

- [ ] **Step 1: Atualizar o `README.md`**

Acrescentar, depois da seção "Cartão (fase 4)" e antes de "Testes":

````markdown
## Lote e validade (fase 5A)

Em **Mercados**, ao adicionar ou atualizar um produto, marque **Controla validade** para os perecíveis. Para esses produtos:

- Toda **entrada** exige a data de validade. Entradas na mesma data somam no mesmo lote.
- A **venda** baixa sempre o lote que vence primeiro (FEFO). Perda e ajuste negativo fazem o mesmo, ou baixam um lote escolhido.
- A seção **Validade** do mercado lista os lotes vencidos e os que vencem em 7 dias, e a página inicial mostra quantos lotes já venceram.
- O totem recusa ("Produto vencido. Procure o atendimento.") um produto cujo saldo inteiro está em lotes vencidos. O produto sai da prateleira e a perda é registrada em **Movimentar**.

O saldo que já existia antes de ligar o controle continua valendo como "saldo sem lote" e sai por último. A NFC-e será a fase 5B.
````

- [ ] **Step 2: Verificação automática completa**

Run: `npm run typecheck && npm test && npm run build`
Expected: tudo passa. Registre a contagem de arquivos e de testes.

- [ ] **Step 3: Roteiro HTTP com servidor real**

Com `docker compose up -d`, `.env` completo, `npm run db:migrate` e `npm run dev -- -p 3457` em segundo plano. Crie os dados com um script descartável FORA do repositório (pasta de rascunho da sessão; apague-o depois). Ele deve fechar os dois pools no fim:

```ts
import { signUp } from "/CAMINHO/DO/REPO/src/auth/service";
import { adminSql, appSql } from "/CAMINHO/DO/REPO/src/db/client";
import { withOrg } from "/CAMINHO/DO/REPO/src/db/tenant";
import { createMarket } from "/CAMINHO/DO/REPO/src/domain/markets";
import { setMarketProduct } from "/CAMINHO/DO/REPO/src/domain/market-products";
import { createProduct } from "/CAMINHO/DO/REPO/src/domain/products";
import { recordMovement } from "/CAMINHO/DO/REPO/src/domain/stock";
import { createTerminal } from "/CAMINHO/DO/REPO/src/domain/terminals";

(async () => {
  const s = Date.now();
  const owner = await signUp({ email: `ana${s}@x.com`, password: "senha-forte-1", orgName: "Mercados Ana" });
  const o = owner.orgId;
  const market = await withOrg(o, (tx) => createMarket(tx, o, { name: "Loja Bloco 1" }));
  const mk = async (name: string, barcode: string, tracks: boolean) => {
    const p = await withOrg(o, (tx) => createProduct(tx, o, { name, barcodes: [barcode] }));
    const mp = await withOrg(o, (tx) =>
      setMarketProduct(tx, o, { marketId: market.id, productId: p.id, priceCents: 590, tracksExpiry: tracks }),
    );
    return mp.id;
  };
  const iogurte = await mk("Iogurte", "1111", true);
  const agua = await mk("Água", "2222", false);
  const term = await withOrg(o, (tx) => createTerminal(tx, o, { marketId: market.id, name: "Totem 1" }));
  // lote vencido de iogurte: só por SQL, porque a entrada recusa data passada
  const [lot] = await adminSql`
    insert into stock_lots (org_id, market_product_id, expires_on) values (${o}, ${iogurte}, current_date - 2) returning id`;
  await adminSql`insert into stock_movements (org_id, market_product_id, type, quantity, lot_id)
    values (${o}, ${iogurte}, 'in', 3, ${lot.id})`;
  await withOrg(o, (tx) => recordMovement(tx, o, null, { marketProductId: agua, type: "in", quantity: 5 }));
  console.log(JSON.stringify({ org: o, market: market.id, terminal: term.token, owner: owner.token, iogurte, agua }));
  await adminSql.end();
  await appSql.end();
})();
```

Executar com `npx tsx --env-file=.env <script>`. Depois, com `curl` (`T` é o token do totem; cada item cria uma venda nova com `POST /api/pdv/sales/items`), conferir e registrar o comando e a saída crua de cada item:

1. `POST /api/pdv/sales/items` com `{"barcode":"1111"}` retorna 404 com `{"error":"product_expired","message":"Produto vencido. Procure o atendimento."}`.
2. Entrada de iogurte com validade futura (script de uma linha com `recordMovement` e `expiresOn` daqui a 10 dias, 4 unidades); repetir o item 1 retorna 200.
3. Pagar essa venda com cartão (`pay` com `{"method":"card"}`) e aprovar com `POST /api/dev/fake-card/<id>/approve`; a venda fica `paid`. A consulta `select quantity, lot_id from stock_movements where sale_id = '<id>'` mostra a baixa saindo do lote vencido (`current_date - 2`), não do novo.
4. Entrada com data passada pelo domínio (`recordMovement` com `expiresOn` de ontem) falha com `invalid_input` e nenhum lote novo aparece (`select count(*) from stock_lots`).
5. Água (sem controle): item `{"barcode":"2222"}` retorna 200; pagar com Pix e `POST /api/dev/fake-pix/<id>/pay`; o movimento de venda tem `lot_id` nulo.
6. Painel com o cookie `m77_session=<owner>`: `GET /o/<org>/markets/<market>` retorna 200 e contém "Validade", "Iogurte" e "Vencido"; `GET /o/<org>` retorna 200 e contém "vencido".
7. Isolamento: com o cookie de outra organização, `GET /o/<org>/markets/<market>` retorna 404.

Encerrar o servidor por completo (`pkill -f "next dev"`), apagar o script descartável e conferir que nada ficou rodando (`pgrep -fl "next|tsx"` vazio) e que `git status` está limpo.

- [ ] **Step 4: Roteiro manual no navegador (feito pelo dono do projeto)**

1. No painel, **Mercados**, abrir o mercado, salvar um produto com **Controla validade** marcada.
2. Em **Movimentar**, registrar uma entrada de 3 unidades com validade daqui a 3 dias: a seção **Validade** lista o lote como "Vence em breve".
3. Registrar uma entrada sem data: aparece o aviso de dados inválidos e nada é gravado.
4. No `/pdv`, vender 1 unidade; no painel, o saldo do lote cai em 1.
5. Perda escolhendo o lote no select e outra deixando "o que vence primeiro": os saldos mudam como esperado.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: document phase 5A lots and expiry"
```

---

## Auto-revisão

**Cobertura do spec:** seção 2 (decisões) nas Tarefas 1 a 5; seção 3 (dados) na Tarefa 1; seção 4 (domínio: `lots.ts` na Tarefa 2, `recordMovement` na 3, baixa da venda na 4, bloqueio na 5, alertas na 6, mensagem na 5); seção 5 (painel) nas Tarefas 2 (flag), 3 (regras) e 7 (interface); seção 6 (erros e bordas) distribuída nos testes das Tarefas 3 a 5; seção 7 (testes) distribuída, com o roteiro manual na Tarefa 8.

**Decisão do plano que o spec não fixava:** `sale` manual no painel ("Venda" em Movimentar) segue as mesmas regras de perda para produto com controle (FEFO ou lote escolhido), porque grava quantidade negativa.

**Desvio do spec, já refletido nele:** a página inicial usa `listExpiryAlerts` por mercado em vez de uma função `countExpired` separada.

**Consistência de tipos:** `planFefo`, `allocateFefo`, `Allocation`, `LotBalance`, `lockProducts`, `isFullyExpired`, `getOrCreateLot`, `listExpiryAlerts` e `debitSale` têm a mesma assinatura onde são definidos (Tarefas 2, 4 e 6) e onde são usados (Tarefas 3, 4, 5 e 7); `recordMovement` ganha só o parâmetro final `now` e dois campos opcionais, então os chamadores existentes não mudam.
