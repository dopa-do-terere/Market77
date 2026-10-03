# Fase 4: Cartão na maquininha (adaptador simulado) - Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O cliente do totem paga com cartão na maquininha (adaptador simulado), a venda é paga e o estoque baixa uma única vez na aprovação, e recusa, cancelamento e tempo esgotado devolvem o carrinho com o motivo.

**Architecture:** Monólito Next.js sobre as fases 1 a 3. Uma interface nova `CardProvider` (ao lado do `PaymentProvider` do Pix) com o adaptador `fake-card`; a mesma tabela `payments` (agora com `method` e `failure_reason`), o mesmo `confirmPayment`, o mesmo webhook (rota nova para cartão) e a mesma reconciliação preguiçosa, com consulta a cada 2 s para cartão. Sem ponte do agente: o cartão é tratado do lado do servidor.

**Tech Stack:** Next.js 15, React 19, TypeScript, Postgres 16, `postgres` (postgres.js), `zod`, `vitest`, `tsx` (todos já instalados). Nenhuma dependência nova.

**Spec:** `docs/superpowers/specs/2026-10-03-fase-4-cartao-design.md` (spec geral: `docs/superpowers/specs/2026-10-01-market77-design.md`)

## Global Constraints

- Stack: Next.js + TypeScript, Postgres com Row Level Security; migrations em SQL puro, sem ORM. Nenhuma dependência nova. Nenhuma tabela nova: só a migration `0005` altera `payments`.
- Todo acesso a dados de negócio passa por `withOrg()`. O `adminSql` só descobre a organização (token do totem, `payments.provider` + `external_id` + `method` no webhook, varredura de reconciliação).
- Valores monetários são inteiros em centavos. Interface em português do Brasil. Nenhum emoji em código, commits ou arquivos.
- Só um pagamento pendente por venda (índice `payments_one_pending_idx`). Trocar de método encerra o pendente do outro; um cartão pendente é cancelado na maquininha antes, e se o cancelamento falhar o pagamento continua pendente e a chamada responde `provider_unavailable`.
- Validade do cartão 2 minutos (`CARD_TTL_MS = 2 * 60_000`); consulta ao provedor de cartão no máximo a cada 2 s por pagamento (`CARD_CHECK_INTERVAL_MS = 2_000`); Pix continua com `QR_TTL_MS = 3 * 60_000` e `CHECK_INTERVAL_MS = 10_000`.
- `failure_reason` só aceita `declined`, `cancelled`, `expired`. Recusa e cancelamento reportados pela maquininha viram `status = 'failed'`; expiração e cancelamento pedido pelo cliente viram `status = 'expired'`. Um pagamento `confirmed` nunca é revertido.
- `payments.method` aceita `pix` e `card`; `qr_payload` é nulo só no cartão (constraint). O contrato JSON do PDV: `payment.method`, `payment.qrPayload` nulo no cartão, `payment.failureReason`, e `paymentFailure: { method, reason } | null`.
- `POST /api/pdv/sales/:id/pay` sem corpo ou sem `method` continua sendo Pix (compatibilidade). Entradas ruins nunca dão 500: método desconhecido e JSON quebrado viram 400, ids malformados viram 404.
- O adaptador `fake-card` e as rotas `/api/dev/fake-card/...` recusam funcionar com `NODE_ENV=production`. Nenhuma credencial real no repositório; só segredos de desenvolvimento no `.env.example`.
- Comportamento do Pix e todos os testes existentes continuam como estão; onde o tipo `qrPayload` passa a ser `string | null`, os testes existentes só ganham `!`.
- Fora desta fase: ponte do agente com SDK local, provedor real de cartão, credenciais por organização, estorno e devolução, parcelamento, NFC-e, lote e validade.

## Review Focus

1. Cliente aperta Cancelar no instante em que a maquininha aprova, e provedor fora do ar ao cancelar: a venda é paga (aprovação) ou o pagamento continua pendente; nunca se descarta um pagamento aprovado nem se libera a venda com a máquina ainda cobrando (Tarefa 4).
2. Webhook de recusa duplicado, fora de ordem ou depois da aprovação: nunca reverte um pagamento confirmado, nem reabre uma venda que já tem outro pagamento pendente (Tarefas 4 e 6).
3. Trocar de Pix para cartão e de volta, e chamadas repetidas de `pay`: sempre um único pendente; o anterior é encerrado e o saldo e o estoque baixam uma só vez (Tarefas 1 e 4).
4. Recusa visível em poucos segundos: o webhook de recusa reabre a venda na hora e a consulta preguiçosa roda a cada 2 s para cartão, sem mudar os 10 s do Pix (Tarefas 5 e 6).
5. Método inválido, corpo quebrado, ids malformados, totem de outra organização ou de outro totem, provedor de cartão desconhecido ou fora do ar: sempre 4xx ou 503, nunca 500 (Tarefa 7).
6. Lista de vendas do painel: uma recusa de cartão que o cliente resolveu pagando com Pix não pode aparecer como "requer atenção"; só pagamentos rejeitados pelo `confirmPayment` (valor errado, duplicado) aparecem assim (Tarefas 3 e 9).

---

## Estrutura de arquivos

```
src/db/migrations/0005_card.sql                  # method card, qr_payload nulo, failure_reason
src/payments/card.ts                             # interface CardProvider
src/payments/fake-card.ts                        # adaptador simulado + buildFakeCardWebhook
src/payments/registry.ts                         # + getCardProvider
src/payments/webhook.ts                          # + handleCardWebhook; filtro method no Pix
src/domain/sales.ts                              # PaymentView, paymentFailure, reopenSale
src/domain/payments.ts                           # startPayment com método, cancelPayment, failPayment
src/domain/refresh.ts                            # cartão: consulta de 2 s, falha e expiração
src/domain/sale-queries.ts                       # method e failure_reason; needsAttention
src/lib/labels.ts                                # METHOD_LABEL, FAILURE_LABEL
src/pdv/http.ts                                  # payHandler com method, cancelPaymentHandler
src/pdv/notice.ts                                # paymentNotice (texto do aviso no carrinho)
src/app/api/pdv/sales/[id]/payment/cancel/route.ts
src/app/api/webhooks/card/[provider]/route.ts
src/app/api/dev/fake-card/[externalId]/approve/route.ts, decline/route.ts
src/app/pdv/PdvApp.tsx                           # dois botões, tela do cartão, cancelar
src/app/o/[orgId]/sales/[saleId]/page.tsx        # método e motivo
tests/helpers.ts                                 # seedPayment com method e failureReason
tests/db/card-schema.test.ts
tests/payments/card-contract.ts, fake-card.test.ts, card-webhook.test.ts
tests/domain/payment-view.test.ts, card-payments.test.ts, card-refresh.test.ts, sale-queries-card.test.ts
tests/pdv/card-handlers.test.ts, card-routes.test.ts, notice.test.ts
```

---

### Task 1: Migration 0005 e helpers de teste

**Files:**
- Create: `src/db/migrations/0005_card.sql`, `tests/db/card-schema.test.ts`
- Modify: `tests/helpers.ts` (`seedPayment`), `vitest.config.ts`, `.env.example`

**Interfaces:**
- Consumes: `makeOrg`, `seedSale`, `seedPayment`, `resetDb` de `tests/helpers.ts`; a tabela `payments` da fase 2.
- Produces: `payments.method in ('pix','card')`, `payments.qr_payload` nulo só no cartão, `payments.failure_reason`; `seedPayment(orgId, saleId, o)` aceita `method?: "pix" | "card"` e `failureReason?: string`; `process.env.CARD_PROVIDER` e `FAKE_CARD_SECRET` nos testes.

- [ ] **Step 1: Escrever o teste do esquema (falha)**

Criar `tests/db/card-schema.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { adminSql } from "@/db/client";
import { makeOrg, resetDb, seedPayment, seedSale } from "../helpers";

beforeEach(resetDb);

describe("phase 4 schema", () => {
  it("accepts a card payment without a QR payload", async () => {
    const orgId = await makeOrg("A");
    const { saleId } = await seedSale(orgId);
    const id = await seedPayment(orgId, saleId, { method: "card" });
    const [row] = await adminSql`select method, qr_payload from payments where id = ${id}`;
    expect([row.method, row.qr_payload]).toEqual(["card", null]);
  });

  it("still requires a QR payload for Pix and refuses unknown methods", async () => {
    const orgId = await makeOrg("A");
    const { saleId } = await seedSale(orgId);
    const raw = (method: string, qr: string | null) =>
      adminSql`
        insert into payments (org_id, sale_id, method, provider, external_id, amount_cents, qr_payload, expires_at)
        values (${orgId}, ${saleId}, ${method}, 'fake', ${`x-${method}-${qr}`}, 100, ${qr}, now())`;
    await expect(raw("pix", null)).rejects.toThrow(/check/);
    await expect(raw("boleto", "qr")).rejects.toThrow(/check/);
  });

  it("only accepts the known failure reasons", async () => {
    const orgId = await makeOrg("A");
    const { saleId } = await seedSale(orgId);
    for (const reason of ["declined", "cancelled", "expired"]) {
      await seedPayment(orgId, saleId, { method: "card", status: "failed", failureReason: reason });
    }
    await expect(
      seedPayment(orgId, saleId, { method: "card", status: "failed", failureReason: "oops" }),
    ).rejects.toThrow(/check/);
  });

  it("keeps one pending payment per sale across methods", async () => {
    const orgId = await makeOrg("A");
    const { saleId } = await seedSale(orgId);
    await seedPayment(orgId, saleId, { method: "pix" });
    await expect(seedPayment(orgId, saleId, { method: "card" })).rejects.toThrow(/unique|duplicate/);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/db/card-schema.test.ts`
Expected: FAIL (o helper ainda não conhece `method` e a coluna `failure_reason` não existe).

- [ ] **Step 3: Criar a migration**

Criar `src/db/migrations/0005_card.sql`:

```sql
-- Phase 4: card payments. A payment is Pix or card; only Pix has a QR code.
ALTER TABLE payments DROP CONSTRAINT payments_method_check;
ALTER TABLE payments ADD CONSTRAINT payments_method_check CHECK (method IN ('pix', 'card'));
ALTER TABLE payments ALTER COLUMN qr_payload DROP NOT NULL;
ALTER TABLE payments ADD CONSTRAINT payments_pix_qr_check CHECK (method <> 'pix' OR qr_payload IS NOT NULL);
ALTER TABLE payments ADD COLUMN failure_reason text
  CHECK (failure_reason IN ('declined', 'cancelled', 'expired'));
```

- [ ] **Step 4: Helper, variáveis de teste e `.env.example`**

Em `tests/helpers.ts`, substituir a função `seedPayment` por:

```ts
export async function seedPayment(
  orgId: string,
  saleId: string,
  o: {
    externalId?: string;
    status?: string;
    provider?: string;
    amountCents?: number;
    method?: "pix" | "card";
    failureReason?: string;
  } = {},
) {
  const method = o.method ?? "pix";
  return withOrg(orgId, async (tx) => {
    const [p] = await tx`
      insert into payments (org_id, sale_id, method, provider, external_id, status, amount_cents, qr_payload, expires_at, failure_reason)
      values (${orgId}, ${saleId}, ${method}, ${o.provider ?? "fake"}, ${o.externalId ?? randomUUID()},
        ${o.status ?? "pending"}, ${o.amountCents ?? 1000}, ${method === "pix" ? "qr" : null},
        now() + interval '3 minutes', ${o.failureReason ?? null})
      returning id`;
    return p.id as string;
  });
}
```

Em `vitest.config.ts`, acrescentar ao objeto `env` (depois de `RELEASE_SECRET`):

```ts
  CARD_PROVIDER: "fake",
  FAKE_CARD_SECRET: "test-fake-card-secret",
```

Acrescentar ao fim de `.env.example`:

```
CARD_PROVIDER=fake
FAKE_CARD_SECRET=dev-fake-card-secret
```

E acrescentar as mesmas duas linhas ao `.env` local (arquivo ignorado pelo Git).

- [ ] **Step 5: Rodar o teste, typecheck e a suíte**

Run: `npx vitest run tests/db/card-schema.test.ts && npm run typecheck && npm test`
Expected: PASS (4 testes novos) e a suíte inteira continua passando.

- [ ] **Step 6: Commit**

```bash
git add src/db/migrations/0005_card.sql tests/db/card-schema.test.ts tests/helpers.ts vitest.config.ts .env.example
git commit -m "feat: add phase 4 schema for card payments"
```

---

### Task 2: CardProvider, adaptador `fake-card` e registro

**Files:**
- Create: `src/payments/card.ts`, `src/payments/fake-card.ts`, `tests/payments/card-contract.ts`, `tests/payments/fake-card.test.ts`
- Modify: `src/payments/registry.ts`

**Interfaces:**
- Consumes: `ChargeStatus` de `src/payments/provider.ts`.
- Produces:
  - `src/payments/card.ts`: `type CardFailure = "declined" | "cancelled"`, `type CardWebhookEvent = { externalId: string; status: "confirmed" | "expired" | "failed"; amountCents: number; failureReason?: CardFailure }`, `interface CardProvider { name: string; createCardCharge(i: { saleId: string; amountCents: number; terminalId: string; expiresAt: Date }): Promise<{ externalId: string; expiresAt: Date }>; cancelCardCharge(externalId: string): Promise<void>; getCharge(externalId: string): Promise<{ status: ChargeStatus; amountCents: number; failureReason?: CardFailure }>; parseWebhook(headers: Headers, rawBody: string): CardWebhookEvent | null }`
  - `src/payments/fake-card.ts`: `fakeCardProvider: CardProvider` (nome `"fake"`), `buildFakeCardWebhook(externalId: string, o?: { status?: "confirmed" | "expired" | "failed"; failureReason?: CardFailure; amountCents?: number }): { headers: Headers; rawBody: string }`
  - `src/payments/registry.ts`: `getCardProvider(name?: string): CardProvider` (nome de `CARD_PROVIDER`, padrão `"fake"`; lança `Error("Unknown card provider: <name>")`)

- [ ] **Step 1: Escrever a suíte de contrato e os testes (falham)**

Criar `tests/payments/card-contract.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { CardProvider } from "@/payments/card";

export type CardHarness = {
  provider: CardProvider;
  /** The customer approves on the machine; returns the signed webhook the provider would send. */
  approve(externalId: string): { headers: Headers; rawBody: string };
  /** The card is declined; returns the signed webhook. */
  decline(externalId: string): { headers: Headers; rawBody: string };
  /** A webhook for the charge whose signature is wrong. */
  forged(externalId: string): { headers: Headers; rawBody: string };
};

/** Every card adapter must pass this suite (the real one runs it against its sandbox). */
export function cardProviderContract(name: string, make: () => CardHarness) {
  describe(`card provider contract: ${name}`, () => {
    const expiresAt = new Date("2026-10-03T12:02:00Z");
    const charge = (h: CardHarness) =>
      h.provider.createCardCharge({ saleId: "sale-1", amountCents: 1000, terminalId: "terminal-1", expiresAt });

    it("creates a charge with an id and keeps the expiry", async () => {
      const c = await charge(make());
      expect(c.externalId).not.toBe("");
      expect(c.expiresAt).toEqual(expiresAt);
    });

    it("reports a new charge as pending with the charged amount", async () => {
      const h = make();
      const c = await charge(h);
      expect(await h.provider.getCharge(c.externalId)).toEqual({ status: "pending", amountCents: 1000 });
    });

    it("reports an approved charge as confirmed", async () => {
      const h = make();
      const c = await charge(h);
      h.approve(c.externalId);
      expect((await h.provider.getCharge(c.externalId)).status).toBe("confirmed");
    });

    it("reports a declined charge as failed with the reason", async () => {
      const h = make();
      const c = await charge(h);
      h.decline(c.externalId);
      expect(await h.provider.getCharge(c.externalId)).toEqual({
        status: "failed",
        amountCents: 1000,
        failureReason: "declined",
      });
    });

    it("cancels a pending charge, idempotently, and reports it as failed cancelled", async () => {
      const h = make();
      const c = await charge(h);
      await h.provider.cancelCardCharge(c.externalId);
      await h.provider.cancelCardCharge(c.externalId);
      expect(await h.provider.getCharge(c.externalId)).toEqual({
        status: "failed",
        amountCents: 1000,
        failureReason: "cancelled",
      });
    });

    it("never cancels a charge that was already approved", async () => {
      const h = make();
      const c = await charge(h);
      h.approve(c.externalId);
      await h.provider.cancelCardCharge(c.externalId);
      expect((await h.provider.getCharge(c.externalId)).status).toBe("confirmed");
    });

    it("parses genuine webhooks into events", async () => {
      const h = make();
      const c = await charge(h);
      const ok = h.approve(c.externalId);
      expect(h.provider.parseWebhook(ok.headers, ok.rawBody)).toEqual({
        externalId: c.externalId,
        status: "confirmed",
        amountCents: 1000,
      });
      const d = await charge(h);
      const no = h.decline(d.externalId);
      expect(h.provider.parseWebhook(no.headers, no.rawBody)).toEqual({
        externalId: d.externalId,
        status: "failed",
        amountCents: 1000,
        failureReason: "declined",
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

Criar `tests/payments/fake-card.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildFakeCardWebhook, fakeCardProvider } from "@/payments/fake-card";
import { getCardProvider } from "@/payments/registry";
import { cardProviderContract } from "./card-contract";

afterEach(() => vi.unstubAllEnvs());

cardProviderContract("fake-card", () => ({
  provider: fakeCardProvider,
  approve: (id) => buildFakeCardWebhook(id, { status: "confirmed" }),
  decline: (id) => buildFakeCardWebhook(id, { status: "failed", failureReason: "declined" }),
  forged: (id) => ({
    headers: new Headers({ "x-fake-signature": "00" }),
    rawBody: JSON.stringify({ externalId: id, status: "confirmed", amountCents: 1 }),
  }),
}));

describe("fake card provider guards", () => {
  const args = { saleId: "s", amountCents: 100, terminalId: "t", expiresAt: new Date() };

  it("refuses to run in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(fakeCardProvider.createCardCharge(args)).rejects.toThrow(/production/);
  });

  it("refuses to run without a webhook secret", async () => {
    vi.stubEnv("FAKE_CARD_SECRET", "");
    await expect(fakeCardProvider.createCardCharge(args)).rejects.toThrow(/FAKE_CARD_SECRET/);
  });
});

describe("card provider registry", () => {
  it("returns the fake provider by default and by name", () => {
    expect(getCardProvider().name).toBe("fake");
    expect(getCardProvider("fake")).toBe(fakeCardProvider);
  });

  it.each(["nope", "constructor", "__proto__", "toString"])("rejects the unknown provider %s", (name) => {
    expect(() => getCardProvider(name)).toThrow(/Unknown card provider/);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/payments/fake-card.test.ts`
Expected: FAIL com `Cannot find module '@/payments/fake-card'`.

- [ ] **Step 3: Implementar `src/payments/card.ts`**

```ts
import type { ChargeStatus } from "./provider";

export type CardFailure = "declined" | "cancelled";

export type CardWebhookEvent = {
  externalId: string;
  status: "confirmed" | "expired" | "failed";
  amountCents: number;
  failureReason?: CardFailure;
};

export interface CardProvider {
  name: string;
  createCardCharge(i: {
    saleId: string;
    amountCents: number;
    terminalId: string;
    expiresAt: Date;
  }): Promise<{ externalId: string; expiresAt: Date }>;
  /** Tells the machine to stop waiting. Idempotent; never cancels a charge that was already approved. */
  cancelCardCharge(externalId: string): Promise<void>;
  getCharge(
    externalId: string,
  ): Promise<{ status: ChargeStatus; amountCents: number; failureReason?: CardFailure }>;
  /** Verifies the signature (throws when invalid). Returns null for events we do not care about. */
  parseWebhook(headers: Headers, rawBody: string): CardWebhookEvent | null;
}
```

- [ ] **Step 4: Implementar `src/payments/fake-card.ts`**

```ts
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { CardFailure, CardProvider } from "./card";
import type { ChargeStatus } from "./provider";

type Charge = { amountCents: number; status: ChargeStatus; failureReason?: CardFailure };

// ponytail: charge state lives in memory, for dev and tests only. A real adapter asks its provider instead.
const g = globalThis as unknown as { __m77fakeCard?: Map<string, Charge> };
const charges = (g.__m77fakeCard ??= new Map<string, Charge>());

/** Throws in production or without a secret; returns the webhook secret. */
function guard(): string {
  if (process.env.NODE_ENV === "production") throw new Error("fake card provider is disabled in production");
  const secret = process.env.FAKE_CARD_SECRET;
  if (!secret) throw new Error("Missing env var FAKE_CARD_SECRET");
  return secret;
}

const sign = (secret: string, body: string) => createHmac("sha256", secret).update(body).digest("hex");

const Event = z.object({
  externalId: z.string().min(1),
  status: z.enum(["confirmed", "expired", "failed"]),
  amountCents: z.number().int().min(0),
  failureReason: z.enum(["declined", "cancelled"]).optional(),
});

export const fakeCardProvider: CardProvider = {
  name: "fake",

  async createCardCharge({ amountCents, expiresAt }) {
    guard();
    const externalId = `fakecard_${randomUUID()}`;
    charges.set(externalId, { amountCents, status: "pending" });
    return { externalId, expiresAt };
  },

  async cancelCardCharge(externalId) {
    guard();
    const c = charges.get(externalId);
    if (c && c.status === "pending") {
      c.status = "failed";
      c.failureReason = "cancelled";
    }
  },

  async getCharge(externalId) {
    guard();
    const c = charges.get(externalId);
    if (!c) throw new Error(`unknown fake card charge ${externalId}`);
    return {
      status: c.status,
      amountCents: c.amountCents,
      ...(c.failureReason ? { failureReason: c.failureReason } : {}),
    };
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
 * Simulates the machine deciding the outcome of a charge and the provider notifying us.
 * The signed body goes through the real webhook path, so production code is exercised.
 */
export function buildFakeCardWebhook(
  externalId: string,
  o: { status?: "confirmed" | "expired" | "failed"; failureReason?: CardFailure; amountCents?: number } = {},
): { headers: Headers; rawBody: string } {
  const secret = guard();
  const charge = charges.get(externalId);
  const status = o.status ?? "confirmed";
  if (charge) {
    charge.status = status;
    if (o.failureReason) charge.failureReason = o.failureReason;
  }
  const rawBody = JSON.stringify({
    externalId,
    status,
    amountCents: o.amountCents ?? charge?.amountCents ?? 0,
    ...(o.failureReason ? { failureReason: o.failureReason } : {}),
  });
  return { headers: new Headers({ "x-fake-signature": sign(secret, rawBody) }), rawBody };
}
```

- [ ] **Step 5: Registrar o provedor de cartão**

Substituir `src/payments/registry.ts` por:

```ts
import type { CardProvider } from "./card";
import { fakeProvider } from "./fake";
import { fakeCardProvider } from "./fake-card";
import type { PaymentProvider } from "./provider";

const PROVIDERS: Record<string, PaymentProvider> = { fake: fakeProvider };
const CARD_PROVIDERS: Record<string, CardProvider> = { fake: fakeCardProvider };

// ponytail: one global provider chosen by env. Per-organization selection arrives with provider_credentials.
export function getProvider(name: string = process.env.PIX_PROVIDER ?? "fake"): PaymentProvider {
  // hasOwn: the name comes from a URL, so "constructor" must not resolve to Object.prototype members.
  if (!Object.hasOwn(PROVIDERS, name)) throw new Error(`Unknown Pix provider: ${name}`);
  return PROVIDERS[name];
}

export function getCardProvider(name: string = process.env.CARD_PROVIDER ?? "fake"): CardProvider {
  if (!Object.hasOwn(CARD_PROVIDERS, name)) throw new Error(`Unknown card provider: ${name}`);
  return CARD_PROVIDERS[name];
}
```

- [ ] **Step 6: Rodar os testes, typecheck e suíte**

Run: `npx vitest run tests/payments && npm run typecheck && npm test`
Expected: PASS; a suíte inteira continua passando.

- [ ] **Step 7: Commit**

```bash
git add src/payments/card.ts src/payments/fake-card.ts src/payments/registry.ts tests/payments/card-contract.ts tests/payments/fake-card.test.ts
git commit -m "feat: add CardProvider contract, fake card adapter and registry"
```

---

### Task 3: Leitura da venda com método e motivo (domínio e painel)

**Files:**
- Modify: `src/domain/sales.ts`, `src/domain/refresh.ts`, `src/domain/sale-queries.ts`, `src/lib/labels.ts`, e os testes existentes que usam `qrPayload`
- Create: `tests/domain/payment-view.test.ts`, `tests/domain/sale-queries-card.test.ts`

**Interfaces:**
- Consumes: `seedSale`, `seedPayment` (com `method` e `failureReason`), `getSaleView`, `listRecentSales`, `getSaleDetail`.
- Produces:
  - `src/domain/sales.ts`: `PaymentView` com `method: "pix" | "card"`, `qrPayload: string | null`, `failureReason: "declined" | "cancelled" | "expired" | null`; `type PaymentFailure = { method: "pix" | "card"; reason: "declined" | "cancelled" | "expired" }`; `SaleView.paymentFailure: PaymentFailure | null`; `reopenSale(tx: Tx, saleId: string, now: Date): Promise<void>`
  - `src/domain/sale-queries.ts`: `SaleDetail.payments[]` ganha `method: string` e `failureReason: string | null`; `SaleListRow.needsAttention` só vale para pagamentos `failed` sem `failure_reason`
  - `src/lib/labels.ts`: `METHOD_LABEL`, `FAILURE_LABEL`

- [ ] **Step 1: Escrever os testes (falham)**

Criar `tests/domain/payment-view.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { adminSql } from "@/db/client";
import { withOrg } from "@/db/tenant";
import { getSaleView } from "@/domain/sales";
import { makeOrg, resetDb, seedPayment, seedSale } from "../helpers";

beforeEach(resetDb);

async function open() {
  const orgId = await makeOrg("A");
  const s = await seedSale(orgId);
  const view = () => withOrg(orgId, (tx) => getSaleView(tx, s.saleId));
  return { orgId, ...s, view };
}

describe("getSaleView payment fields", () => {
  it("shows the method and no QR for a pending card payment, and no failure", async () => {
    const r = await open();
    await seedPayment(r.orgId, r.saleId, { method: "card" });
    const v = await r.view();
    expect(v.payment).toMatchObject({ method: "card", qrPayload: null, failureReason: null, status: "pending" });
    expect(v.paymentFailure).toBeNull();
  });

  it("reports the failure of the last payment of an open sale", async () => {
    const r = await open();
    await seedPayment(r.orgId, r.saleId, { method: "card", status: "failed", failureReason: "declined" });
    expect((await r.view()).paymentFailure).toEqual({ method: "card", reason: "declined" });
  });

  it("reports an expired or cancelled payment the same way, for Pix too", async () => {
    const r = await open();
    await seedPayment(r.orgId, r.saleId, { method: "pix", status: "expired", failureReason: "cancelled" });
    expect((await r.view()).paymentFailure).toEqual({ method: "pix", reason: "cancelled" });
  });

  it("does not report a failure without a reason, such as a payment the confirmation rejected", async () => {
    const r = await open();
    await seedPayment(r.orgId, r.saleId, { method: "card", status: "failed" });
    expect((await r.view()).paymentFailure).toBeNull();
  });

  it("does not report a failure once a new payment is pending or the sale is not open", async () => {
    const r = await open();
    await seedPayment(r.orgId, r.saleId, { method: "card", status: "failed", failureReason: "declined" });
    await seedPayment(r.orgId, r.saleId, { method: "pix" });
    expect((await r.view()).paymentFailure).toBeNull();
    await adminSql`update sales set status = 'awaiting_payment' where id = ${r.saleId}`;
    expect((await r.view()).paymentFailure).toBeNull();
  });
});
```

Criar `tests/domain/sale-queries-card.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { withOrg } from "@/db/tenant";
import { getSaleDetail, listRecentSales } from "@/domain/sale-queries";
import { makeOrg, resetDb, seedPayment, seedSale } from "../helpers";

beforeEach(resetDb);

async function one(opts: Parameters<typeof seedPayment>[2]) {
  const orgId = await makeOrg("A");
  const { saleId } = await seedSale(orgId);
  await seedPayment(orgId, saleId, opts);
  return { orgId, saleId };
}

describe("sales for the owner panel", () => {
  it("does not flag a card payment that was declined for attention", async () => {
    const { orgId } = await one({ method: "card", status: "failed", failureReason: "declined" });
    const [row] = await withOrg(orgId, (tx) => listRecentSales(tx));
    expect(row.needsAttention).toBe(false);
  });

  it("flags a payment that the confirmation rejected (failed without a reason)", async () => {
    const { orgId } = await one({ method: "card", status: "failed" });
    const [row] = await withOrg(orgId, (tx) => listRecentSales(tx));
    expect(row.needsAttention).toBe(true);
  });

  it("returns the method and the failure reason in the detail", async () => {
    const { orgId, saleId } = await one({ method: "card", status: "failed", failureReason: "declined" });
    const detail = await withOrg(orgId, (tx) => getSaleDetail(tx, saleId));
    expect(detail?.payments[0]).toMatchObject({ method: "card", status: "failed", failureReason: "declined" });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/domain/payment-view.test.ts tests/domain/sale-queries-card.test.ts`
Expected: FAIL (os campos novos não existem; `needsAttention` ainda marca toda recusa).

- [ ] **Step 3: `src/domain/sales.ts`**

Trocar os tipos `PaymentView` e `SaleView` e acrescentar `PaymentFailure`:

```ts
export type PaymentView = {
  id: string;
  status: "pending" | "confirmed" | "expired" | "failed";
  method: "pix" | "card";
  amountCents: number;
  qrPayload: string | null;
  expiresAt: Date;
  failureReason: "declined" | "cancelled" | "expired" | null;
};
export type PaymentFailure = { method: "pix" | "card"; reason: "declined" | "cancelled" | "expired" };
export type SaleView = {
  id: string;
  status: SaleStatus;
  totalCents: number;
  expiresAt: Date;
  items: SaleItemView[];
  payment: PaymentView | null;
  paymentFailure: PaymentFailure | null;
};
```

Em `getSaleView`, trocar a consulta do pagamento e o objeto retornado por:

```ts
  const [p] = await tx`
    select id, status, method, amount_cents, qr_payload, expires_at, failure_reason
    from payments where sale_id = ${saleId} order by created_at desc limit 1`;
  const payment: PaymentView | null = p
    ? {
        id: p.id as string,
        status: p.status as PaymentView["status"],
        method: p.method as PaymentView["method"],
        amountCents: p.amount_cents as number,
        qrPayload: (p.qr_payload as string | null) ?? null,
        expiresAt: p.expires_at as Date,
        failureReason: (p.failure_reason as PaymentView["failureReason"]) ?? null,
      }
    : null;
  // Only the last payment of a sale that is back at the cart counts; a rejected confirmation has no reason.
  const paymentFailure: PaymentFailure | null =
    payment &&
    s.status === "open" &&
    (payment.status === "failed" || payment.status === "expired") &&
    payment.failureReason
      ? { method: payment.method, reason: payment.failureReason }
      : null;
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
    payment,
    paymentFailure,
  };
```

Acrescentar, depois de `lockSale`, a função compartilhada (antes em `refresh.ts` como `reopen`):

```ts
/** Puts a sale back at the cart with a fresh inactivity window; the cart is untouched. */
export async function reopenSale(tx: Tx, saleId: string, now: Date): Promise<void> {
  await tx`update sales set status = 'open', expires_at = ${plus(now, CART_TTL_MS)} where id = ${saleId}`;
}
```

- [ ] **Step 4: `src/domain/refresh.ts` usa `reopenSale`**

Em `src/domain/refresh.ts`: remover a função local `reopen` e o `CART_TTL_MS` do import; importar `reopenSale` de `./sales` e trocar cada `reopen(tx, sale.id, now)` por `reopenSale(tx, sale.id, now)`. Nada mais muda neste arquivo.

- [ ] **Step 5: `src/domain/sale-queries.ts` e `src/lib/labels.ts`**

Em `listRecentSales`, trocar o `exists` de atenção por:

```sql
      exists (select 1 from payments p where p.sale_id = s.id and p.status = 'failed' and p.failure_reason is null) as needs_attention
```

Em `SaleDetail`, acrescentar a cada item de `payments`: `method: string; failureReason: string | null;`. Em `getSaleDetail`, a consulta passa a ser:

```ts
  const payments = await tx`
    select id, status, method, provider, amount_cents, failure_reason,
      (webhook_payload->>'paidAmountCents')::numeric as paid_amount_cents, created_at
    from payments where sale_id = ${saleId} order by created_at, id`;
```

e o mapeamento ganha `method: p.method as string,` e `failureReason: (p.failure_reason as string | null) ?? null,`.

Acrescentar ao fim de `src/lib/labels.ts`:

```ts
export const METHOD_LABEL: Record<string, string> = {
  pix: "Pix",
  card: "Cartão",
};

export const FAILURE_LABEL: Record<string, string> = {
  declined: "Recusado",
  cancelled: "Cancelado",
  expired: "Expirado",
};
```

- [ ] **Step 6: Ajustar os testes existentes ao tipo novo**

`qrPayload` passou a ser `string | null`. Rodar `npm run typecheck`; cada erro `Object is possibly 'null'` em testes que fazem `view.payment!.qrPayload.split("|")` (ou equivalente) se resolve com `qrPayload!` (exemplo: `view.payment!.qrPayload!.split("|")[1]`). Achar todos com `grep -rn "qrPayload" tests`. Testes que comparam objetos inteiros de `SaleView` ou de `payments` do detalhe com `toEqual` passam a precisar dos campos novos (`method`, `failureReason`, `paymentFailure`); ajuste-os acrescentando esses campos. Nenhuma outra mudança nos testes existentes.

- [ ] **Step 7: Rodar os testes, typecheck e suíte**

Run: `npx vitest run tests/domain/payment-view.test.ts tests/domain/sale-queries-card.test.ts && npm run typecheck && npm test`
Expected: PASS; a suíte inteira continua passando.

- [ ] **Step 8: Commit**

```bash
git add src/domain src/lib/labels.ts tests
git commit -m "feat: expose payment method and failure reason in sale views"
```

---

### Task 4: Domínio do pagamento (cartão, cancelar, falhar)

**Files:**
- Modify: `src/domain/payments.ts`
- Create: `tests/domain/card-payments.test.ts`

**Interfaces:**
- Consumes: `CardProvider` (`@/payments/card`), `getCardProvider` (`@/payments/registry`), `withTimeout` e `PaymentProvider` (`@/payments/provider`), `reopenSale`, `getSaleView`, `lockSale`, `SaleView`, `TerminalCtx` (`./sales`), `confirmPayment` (já neste arquivo), `fakeCardProvider`, `buildFakeCardWebhook`.
- Produces (todos em `src/domain/payments.ts`):
  - `CARD_TTL_MS = 2 * 60_000`, `type PayMethod = "pix" | "card"`, `type FailReason = "declined" | "cancelled" | "expired"`
  - `startPayment(tx, orgId, term, saleId, provider: PaymentProvider, now, opts?: { method?: PayMethod; card?: CardProvider }): Promise<SaleView>` (sem `opts` continua Pix; sem `opts.card` o provedor de cartão vem de `getCardProvider()`)
  - `cancelPayment(tx, term, saleId, now, card?: CardProvider): Promise<SaleView>`
  - `failPayment(tx, paymentId, reason: FailReason, now): Promise<boolean>` (`true` se mudou, `false` se o pagamento já não estava pendente)

- [ ] **Step 1: Escrever os testes (falham)**

Criar `tests/domain/card-payments.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { adminSql } from "@/db/client";
import { withOrg } from "@/db/tenant";
import { CARD_TTL_MS, cancelPayment, confirmPayment, failPayment, startPayment } from "@/domain/payments";
import { addItemByBarcode } from "@/domain/sales";
import { getBalance } from "@/domain/stock";
import type { CardProvider } from "@/payments/card";
import { fakeProvider } from "@/payments/fake";
import { buildFakeCardWebhook, fakeCardProvider } from "@/payments/fake-card";
import { codeOf, makeOrg, resetDb, seedSellable, seedStore } from "../helpers";

beforeEach(resetDb);

const NOW = new Date("2026-10-03T12:00:00Z");
const at = (ms: number) => new Date(NOW.getTime() + ms);
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

const down = (over: Partial<CardProvider>): CardProvider => ({ ...fakeCardProvider, ...over });
const payCard = (r: Ready, now = NOW, card: CardProvider = fakeCardProvider) =>
  withOrg(r.orgId, (tx) => startPayment(tx, r.orgId, r.store, r.saleId, fakeProvider, now, { method: "card", card }));
const payPix = (r: Ready, now = NOW, card?: CardProvider) =>
  withOrg(r.orgId, (tx) => startPayment(tx, r.orgId, r.store, r.saleId, fakeProvider, now, { card }));
const cancel = (r: Ready, now = NOW, card: CardProvider = fakeCardProvider, store = r.store) =>
  withOrg(r.orgId, (tx) => cancelPayment(tx, store, r.saleId, now, card));
const rows = (r: Ready) =>
  adminSql`select id, method, status, failure_reason, external_id from payments where sale_id = ${r.saleId} order by created_at, id`;
const saleStatus = async (r: Ready) =>
  (await adminSql`select status from sales where id = ${r.saleId}`)[0].status as string;
const balance = (r: Ready) => withOrg(r.orgId, (tx) => getBalance(tx, r.item.marketProductId));

describe("startPayment with card", () => {
  it("creates a pending card payment for the frozen total, without a QR, valid for two minutes", async () => {
    const r = await ready();
    const view = await payCard(r);
    expect(view.status).toBe("awaiting_payment");
    expect(view.payment).toMatchObject({ method: "card", status: "pending", amountCents: 1000, qrPayload: null });
    expect(view.payment?.expiresAt).toEqual(at(CARD_TTL_MS));
  });

  it("returns the same charge when called again while it is valid", async () => {
    const r = await ready();
    await payCard(r);
    await payCard(r, at(30_000));
    expect(await rows(r)).toHaveLength(1);
  });

  it("issues a new charge after the time ran out and marks the old payment expired", async () => {
    const r = await ready();
    await payCard(r);
    await payCard(r, at(CARD_TTL_MS + 1000));
    const all = await rows(r);
    expect(all.map((p) => [p.status, p.failure_reason])).toEqual([["expired", "expired"], ["pending", null]]);
  });

  it("switching from Pix to card ends the Pix payment as cancelled and keeps one pending", async () => {
    const r = await ready();
    await payPix(r);
    const view = await payCard(r, at(1000));
    expect(view.payment?.method).toBe("card");
    const all = await rows(r);
    expect(all.map((p) => [p.method, p.status, p.failure_reason])).toEqual([
      ["pix", "expired", "cancelled"],
      ["card", "pending", null],
    ]);
  });

  it("switching from card to Pix cancels the charge on the machine", async () => {
    const r = await ready();
    await payCard(r);
    const [card] = await rows(r);
    const view = await payPix(r, at(1000));
    expect(view.payment?.method).toBe("pix");
    expect((await rows(r)).map((p) => [p.method, p.status, p.failure_reason])).toEqual([
      ["card", "expired", "cancelled"],
      ["pix", "pending", null],
    ]);
    expect(await fakeCardProvider.getCharge(card.external_id as string)).toMatchObject({
      status: "failed",
      failureReason: "cancelled",
    });
  });

  it("keeps the card pending and answers provider_unavailable when the machine cannot be told to stop", async () => {
    const r = await ready();
    await payCard(r);
    const broken = down({ cancelCardCharge: async () => { throw new Error("down"); } });
    expect(await codeOf(payPix(r, at(1000), broken))).toBe("provider_unavailable");
    expect((await rows(r)).map((p) => [p.method, p.status])).toEqual([["card", "pending"]]);
    expect(await saleStatus(r)).toBe("awaiting_payment");
  });

  it("answers provider_unavailable when the charge cannot be created, leaving the cart open", async () => {
    const r = await ready();
    const broken = down({ createCardCharge: async () => { throw new Error("down"); } });
    expect(await codeOf(payCard(r, NOW, broken))).toBe("provider_unavailable");
    expect(await rows(r)).toHaveLength(0);
    expect(await saleStatus(r)).toBe("open");
  });

  it("answers provider_unavailable for an unknown card provider in the environment", async () => {
    const r = await ready();
    vi.stubEnv("CARD_PROVIDER", "nope");
    const code = await codeOf(
      withOrg(r.orgId, (tx) => startPayment(tx, r.orgId, r.store, r.saleId, fakeProvider, NOW, { method: "card" })),
    );
    vi.unstubAllEnvs();
    expect(code).toBe("provider_unavailable");
  });

  it("pays the sale once when the approval arrives, whatever the method used first", async () => {
    const r = await ready();
    await payPix(r);
    await payCard(r, at(1000));
    const [, card] = await rows(r);
    await withOrg(r.orgId, (tx) => confirmPayment(tx, card.id as string, 1000, { test: true }, at(2000)));
    expect(await saleStatus(r)).toBe("paid");
    expect(await balance(r)).toBe(-2);
  });
});

describe("cancelPayment", () => {
  it("cancels a card payment: the sale goes back to the cart and the machine stops waiting", async () => {
    const r = await ready();
    await payCard(r);
    const [card] = await rows(r);
    const view = await cancel(r, at(1000));
    expect(view.status).toBe("open");
    expect(view.paymentFailure).toEqual({ method: "card", reason: "cancelled" });
    expect((await rows(r)).map((p) => [p.status, p.failure_reason])).toEqual([["expired", "cancelled"]]);
    expect(await fakeCardProvider.getCharge(card.external_id as string)).toMatchObject({ status: "failed" });
  });

  it("cancels a Pix payment too", async () => {
    const r = await ready();
    await payPix(r);
    expect((await cancel(r, at(1000))).status).toBe("open");
    expect((await rows(r)).map((p) => [p.status, p.failure_reason])).toEqual([["expired", "cancelled"]]);
  });

  it("is idempotent on a sale that is already back at the cart", async () => {
    const r = await ready();
    await payCard(r);
    await cancel(r, at(1000));
    expect((await cancel(r, at(2000))).status).toBe("open");
    expect(await rows(r)).toHaveLength(1);
  });

  it("refuses a sale that is already paid", async () => {
    const r = await ready();
    const view = await payCard(r);
    await withOrg(r.orgId, (tx) => confirmPayment(tx, view.payment!.id, 1000, {}, at(1000)));
    expect(await codeOf(cancel(r, at(2000)))).toBe("sale_not_editable");
  });

  it("keeps the payment pending when the machine cannot be told to stop", async () => {
    const r = await ready();
    await payCard(r);
    const broken = down({ cancelCardCharge: async () => { throw new Error("down"); } });
    expect(await codeOf(cancel(r, at(1000), broken))).toBe("provider_unavailable");
    expect((await rows(r)).map((p) => p.status)).toEqual(["pending"]);
    expect(await saleStatus(r)).toBe("awaiting_payment");
  });

  it("pays the sale instead when the machine had already approved at that instant", async () => {
    const r = await ready();
    await payCard(r);
    const [card] = await rows(r);
    buildFakeCardWebhook(card.external_id as string, { status: "confirmed" });
    const view = await cancel(r, at(1000));
    expect(view.status).toBe("paid");
    expect((await rows(r)).map((p) => p.status)).toEqual(["confirmed"]);
    expect(await balance(r)).toBe(-2);
  });

  it("reopens a sale whose pending payment is already gone", async () => {
    const r = await ready();
    await payCard(r);
    await adminSql`update payments set status = 'failed', failure_reason = 'declined' where sale_id = ${r.saleId}`;
    expect((await cancel(r, at(1000))).status).toBe("open");
  });

  it("does not touch another terminal's sale", async () => {
    const r = await ready();
    await payCard(r);
    const other = await seedStore(r.orgId);
    expect(await codeOf(cancel(r, at(1000), fakeCardProvider, other))).toBe("sale_not_found");
    expect(await saleStatus(r)).toBe("awaiting_payment");
  });
});

describe("failPayment", () => {
  const pending = async (r: Ready) => (await rows(r)).at(-1)!.id as string;
  const fail = (r: Ready, id: string, reason: "declined" | "cancelled" | "expired", now = NOW) =>
    withOrg(r.orgId, (tx) => failPayment(tx, id, reason, now));

  it("marks the payment failed with the reason and puts the sale back at the cart", async () => {
    const r = await ready();
    await payCard(r);
    expect(await fail(r, await pending(r), "declined", at(1000))).toBe(true);
    expect((await rows(r)).map((p) => [p.status, p.failure_reason])).toEqual([["failed", "declined"]]);
    expect(await saleStatus(r)).toBe("open");
  });

  it("marks an expiry as expired rather than failed", async () => {
    const r = await ready();
    await payCard(r);
    await fail(r, await pending(r), "expired", at(1000));
    expect((await rows(r)).map((p) => [p.status, p.failure_reason])).toEqual([["expired", "expired"]]);
  });

  it("is idempotent", async () => {
    const r = await ready();
    await payCard(r);
    const id = await pending(r);
    expect(await fail(r, id, "declined")).toBe(true);
    expect(await fail(r, id, "declined")).toBe(false);
  });

  it("never reverts a confirmed payment", async () => {
    const r = await ready();
    const view = await payCard(r);
    await withOrg(r.orgId, (tx) => confirmPayment(tx, view.payment!.id, 1000, {}, at(1000)));
    expect(await fail(r, view.payment!.id, "declined", at(2000))).toBe(false);
    expect((await rows(r)).map((p) => p.status)).toEqual(["confirmed"]);
    expect(await saleStatus(r)).toBe("paid");
  });

  it("does not reopen a sale that already waits for another payment", async () => {
    const r = await ready();
    await payCard(r);
    const [oldCard] = await rows(r);
    await payPix(r, at(1000));
    expect(await fail(r, oldCard.id as string, "declined", at(2000))).toBe(false);
    expect(await saleStatus(r)).toBe("awaiting_payment");
  });

  it("answers not_found for unknown and malformed payment ids", async () => {
    const r = await ready();
    expect(await codeOf(fail(r, "00000000-0000-0000-0000-000000000000", "declined"))).toBe("not_found");
    expect(await codeOf(fail(r, "nope", "declined"))).toBe("not_found");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/domain/card-payments.test.ts`
Expected: FAIL (`cancelPayment` e `failPayment` não existem; `startPayment` ignora `opts`).

- [ ] **Step 3: Reescrever o início de `src/domain/payments.ts`**

Substituir TUDO que está acima de `export type ConfirmResult` (imports, `QR_TTL_MS` e a função `startPayment`) por:

```ts
import type postgres from "postgres";
import { z } from "zod";
import type { Tx } from "@/db/tenant";
import { AppError } from "@/lib/errors";
import type { CardProvider } from "@/payments/card";
import { type PaymentProvider, withTimeout } from "@/payments/provider";
import { getCardProvider } from "@/payments/registry";
import { type SaleView, type TerminalCtx, getSaleView, lockSale, reopenSale } from "./sales";

export const QR_TTL_MS = 3 * 60_000;
export const CARD_TTL_MS = 2 * 60_000;

export type PayMethod = "pix" | "card";
export type FailReason = "declined" | "cancelled" | "expired";

const isUuid = (s: string) => z.string().uuid().safeParse(s).success;

function cardProviderOrThrow(card?: CardProvider): CardProvider {
  if (card) return card;
  try {
    return getCardProvider();
  } catch {
    throw new AppError("provider_unavailable");
  }
}

/**
 * Ends a pending payment on behalf of the customer. A card charge is cancelled on the machine first;
 * if that fails the payment stays pending (the machine may still charge) and the caller gets
 * provider_unavailable. When the machine had already approved, the sale is paid instead.
 * Returns "paid" or "ended"; after "ended" the caller puts the sale back at the cart or starts a new payment.
 */
async function endPending(
  tx: Tx,
  p: postgres.Row,
  card: CardProvider | undefined,
  now: Date,
): Promise<"paid" | "ended"> {
  const stillValid = (p.expires_at as Date) > now;
  const externalId = p.external_id as string;
  if (p.method === "card") {
    const provider = cardProviderOrThrow(card);
    let approvedCents: number | null = null;
    if (stillValid) {
      try {
        await withTimeout(provider.cancelCardCharge(externalId));
        const c = await withTimeout(provider.getCharge(externalId));
        if (c.status === "confirmed") approvedCents = c.amountCents;
      } catch {
        throw new AppError("provider_unavailable");
      }
    } else {
      try {
        await withTimeout(provider.cancelCardCharge(externalId)); // best effort: the charge ran out anyway
      } catch {
        // nothing to undo
      }
    }
    if (approvedCents !== null) {
      const result = await confirmPayment(tx, p.id as string, approvedCents, { source: "cancel" }, now);
      return result === "rejected" ? "ended" : "paid";
    }
  }
  await tx`
    update payments set status = 'expired', failure_reason = ${stillValid ? "cancelled" : "expired"}
    where id = ${p.id} and status = 'pending'`;
  return "ended";
}

/**
 * Freezes the total and creates the charge (Pix by default, or card on the machine).
 * A still-valid pending charge of the same method is returned as is; a pending one of the other
 * method (or an expired one) is ended first, so a sale never has two pending payments.
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
  opts: { method?: PayMethod; card?: CardProvider } = {},
): Promise<SaleView> {
  const method: PayMethod = opts.method ?? "pix";
  const sale = await lockSale(tx, term, saleId, now);
  if (sale.status === "awaiting_payment") {
    const [pending] = await tx`
      select id, method, external_id, expires_at from payments where sale_id = ${sale.id} and status = 'pending'`;
    if (pending && pending.method === method && (pending.expires_at as Date) > now) {
      return getSaleView(tx, sale.id);
    }
    if (pending && (await endPending(tx, pending, opts.card, now)) === "paid") return getSaleView(tx, sale.id);
  } else if (sale.status !== "open") {
    throw new AppError("sale_not_editable");
  }

  const [t] = await tx`select total_cents from sales where id = ${sale.id}`;
  const [c] = await tx`select count(*)::int as n from sale_items where sale_id = ${sale.id}`;
  if (c.n === 0) throw new AppError("sale_empty");
  const amountCents = t.total_cents as number;
  const expiresAt = new Date(now.getTime() + (method === "card" ? CARD_TTL_MS : QR_TTL_MS));

  if (method === "card") {
    const card = cardProviderOrThrow(opts.card);
    let charge: Awaited<ReturnType<CardProvider["createCardCharge"]>>;
    try {
      charge = await withTimeout(
        card.createCardCharge({ saleId: sale.id, amountCents, terminalId: term.terminalId, expiresAt }),
      );
    } catch {
      throw new AppError("provider_unavailable");
    }
    await tx`
      insert into payments (org_id, sale_id, method, provider, external_id, amount_cents, qr_payload, expires_at)
      values (${orgId}, ${sale.id}, 'card', ${card.name}, ${charge.externalId}, ${amountCents}, null, ${charge.expiresAt})`;
  } else {
    let charge: Awaited<ReturnType<PaymentProvider["createPixCharge"]>>;
    try {
      charge = await withTimeout(provider.createPixCharge({ saleId: sale.id, amountCents, expiresAt }));
    } catch {
      throw new AppError("provider_unavailable");
    }
    await tx`
      insert into payments (org_id, sale_id, method, provider, external_id, amount_cents, qr_payload, expires_at)
      values (${orgId}, ${sale.id}, 'pix', ${provider.name}, ${charge.externalId}, ${amountCents}, ${charge.qrPayload}, ${charge.expiresAt})`;
  }
  await tx`update sales set status = 'awaiting_payment' where id = ${sale.id}`;
  return getSaleView(tx, sale.id);
}
```

- [ ] **Step 4: Acrescentar `cancelPayment` e `failPayment` ao fim do arquivo**

```ts
/**
 * The customer gives up on the payment. The sale goes back to the cart with the items intact.
 * Idempotent for a sale that is already at the cart; a sale that is not open or awaiting payment
 * cannot be changed. See endPending for what happens on the machine.
 */
export async function cancelPayment(
  tx: Tx,
  term: TerminalCtx,
  saleId: string,
  now: Date,
  card?: CardProvider,
): Promise<SaleView> {
  const sale = await lockSale(tx, term, saleId, now);
  if (sale.status === "open") return getSaleView(tx, sale.id);
  if (sale.status !== "awaiting_payment") throw new AppError("sale_not_editable");
  const [p] = await tx`
    select id, method, external_id, expires_at from payments where sale_id = ${sale.id} and status = 'pending'`;
  if (p && (await endPending(tx, p, card, now)) === "paid") return getSaleView(tx, sale.id);
  await reopenSale(tx, sale.id, now);
  return getSaleView(tx, sale.id);
}

/**
 * Marks a pending payment failed (declined or cancelled on the machine) or expired, and puts the sale
 * back at the cart. Only a pending payment changes, so a late or repeated event is harmless and a
 * confirmed payment is never reverted. Returns whether anything changed.
 */
export async function failPayment(tx: Tx, paymentId: string, reason: FailReason, now: Date): Promise<boolean> {
  if (!isUuid(paymentId)) throw new AppError("not_found");
  const [ref] = await tx`select sale_id from payments where id = ${paymentId}`;
  if (!ref) throw new AppError("not_found");
  // Lock order is always sale, then payment, like confirmPayment and startPayment.
  const [sale] = await tx`select id, status from sales where id = ${ref.sale_id} for update`;
  const [pay] = await tx`select status from payments where id = ${paymentId} for update`;
  if (pay.status !== "pending") return false;
  await tx`
    update payments set status = ${reason === "expired" ? "expired" : "failed"}, failure_reason = ${reason}
    where id = ${paymentId}`;
  if (sale.status === "awaiting_payment") await reopenSale(tx, sale.id as string, now);
  return true;
}
```

- [ ] **Step 5: Rodar os testes, typecheck e suíte**

Run: `npx vitest run tests/domain && npm run typecheck && npm test`
Expected: PASS; os testes de Pix existentes continuam passando (sem `opts` o comportamento é o mesmo).

- [ ] **Step 6: Commit**

```bash
git add src/domain/payments.ts tests/domain/card-payments.test.ts
git commit -m "feat: add card start, cancel and fail to the payment domain"
```

---

### Task 5: Reconciliação preguiçosa do cartão

**Files:**
- Modify: `src/domain/refresh.ts`
- Create: `tests/domain/card-refresh.test.ts`

**Interfaces:**
- Consumes: `failPayment`, `confirmPayment` (`./payments`), `reopenSale`, `lockSale`, `getSaleView` (`./sales`), `CardProvider`, `getCardProvider`, `reconcilePending` (`@/payments/reconcile`, sem mudança de código).
- Produces: `CARD_CHECK_INTERVAL_MS = 2_000`; `refreshSale(tx, term, saleId, provider: PaymentProvider, now, card?: CardProvider): Promise<SaleView>` (o provedor do pagamento pendente é escolhido pelo método; `card` omitido usa `getCardProvider()`, e se esse falhar a venda continua esperando).

- [ ] **Step 1: Escrever os testes (falham)**

Criar `tests/domain/card-refresh.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { adminSql } from "@/db/client";
import { withOrg } from "@/db/tenant";
import { CARD_TTL_MS, startPayment } from "@/domain/payments";
import { CARD_CHECK_INTERVAL_MS, refreshSale } from "@/domain/refresh";
import { addItemByBarcode } from "@/domain/sales";
import { getBalance } from "@/domain/stock";
import type { CardProvider } from "@/payments/card";
import { fakeProvider } from "@/payments/fake";
import { buildFakeCardWebhook, fakeCardProvider } from "@/payments/fake-card";
import { reconcilePending } from "@/payments/reconcile";
import { makeOrg, resetDb, seedSellable, seedStore } from "../helpers";

beforeEach(resetDb);

const NOW = new Date("2026-10-03T12:00:00Z");
const at = (ms: number) => new Date(NOW.getTime() + ms);
const BARCODE = "7891000100103";

async function awaiting(method: "card" | "pix") {
  const orgId = await makeOrg("A");
  const store = await seedStore(orgId);
  const item = await seedSellable(orgId, store.marketId, { barcode: BARCODE, priceCents: 500 });
  const sale = await withOrg(orgId, (tx) => addItemByBarcode(tx, orgId, store, { barcode: BARCODE }, NOW));
  await withOrg(orgId, (tx) =>
    startPayment(tx, orgId, store, sale.id, fakeProvider, NOW, { method, card: fakeCardProvider }),
  );
  const [p] = await adminSql`select id, external_id from payments where sale_id = ${sale.id}`;
  const refresh = (now: Date, card: CardProvider = fakeCardProvider) =>
    withOrg(orgId, (tx) => refreshSale(tx, store, sale.id, fakeProvider, now, card));
  const rows = () => adminSql`select status, failure_reason from payments where sale_id = ${sale.id} order by created_at, id`;
  return { orgId, store, item, saleId: sale.id, externalId: p.external_id as string, refresh, rows };
}

const spy = () => {
  const calls = { get: 0, cancel: 0 };
  const card: CardProvider = {
    ...fakeCardProvider,
    getCharge: async (id) => {
      calls.get++;
      return fakeCardProvider.getCharge(id);
    },
    cancelCardCharge: async (id) => {
      calls.cancel++;
      return fakeCardProvider.cancelCardCharge(id);
    },
  };
  return { calls, card };
};

describe("refreshSale with a card payment", () => {
  it("asks the card provider at most once every 2 seconds", async () => {
    const r = await awaiting("card");
    const { calls, card } = spy();
    expect((await r.refresh(at(500), card)).status).toBe("awaiting_payment");
    expect(calls.get).toBe(1);
    await r.refresh(at(1500), card);
    expect(calls.get).toBe(1);
    await r.refresh(at(500 + CARD_CHECK_INTERVAL_MS), card);
    expect(calls.get).toBe(2);
  });

  it("pays the sale when the machine approved", async () => {
    const r = await awaiting("card");
    buildFakeCardWebhook(r.externalId, { status: "confirmed" });
    expect((await r.refresh(at(CARD_CHECK_INTERVAL_MS))).status).toBe("paid");
    expect(await withOrg(r.orgId, (tx) => getBalance(tx, r.item.marketProductId))).toBe(-1);
  });

  it("puts the sale back at the cart with the reason when the card was declined", async () => {
    const r = await awaiting("card");
    buildFakeCardWebhook(r.externalId, { status: "failed", failureReason: "declined" });
    const view = await r.refresh(at(CARD_CHECK_INTERVAL_MS));
    expect(view.status).toBe("open");
    expect(view.paymentFailure).toEqual({ method: "card", reason: "declined" });
    expect((await r.rows()).map((p) => [p.status, p.failure_reason])).toEqual([["failed", "declined"]]);
  });

  it("reports a charge cancelled on the machine as cancelled", async () => {
    const r = await awaiting("card");
    await fakeCardProvider.cancelCardCharge(r.externalId);
    const view = await r.refresh(at(CARD_CHECK_INTERVAL_MS));
    expect(view.paymentFailure).toEqual({ method: "card", reason: "cancelled" });
  });

  it("expires the charge when the time ran out, and tells the machine to stop", async () => {
    const r = await awaiting("card");
    const { calls, card } = spy();
    const view = await r.refresh(at(CARD_TTL_MS + 3000), card);
    expect(view.status).toBe("open");
    expect(view.paymentFailure).toEqual({ method: "card", reason: "expired" });
    expect((await r.rows()).map((p) => [p.status, p.failure_reason])).toEqual([["expired", "expired"]]);
    expect(calls.cancel).toBe(1);
  });

  it("keeps waiting while the provider is down", async () => {
    const r = await awaiting("card");
    const broken: CardProvider = { ...fakeCardProvider, getCharge: async () => { throw new Error("down"); } };
    expect((await r.refresh(at(CARD_CHECK_INTERVAL_MS), broken)).status).toBe("awaiting_payment");
  });

  it("keeps waiting, without failing, when the configured card provider is unknown", async () => {
    const r = await awaiting("card");
    vi.stubEnv("CARD_PROVIDER", "nope");
    const view = await withOrg(r.orgId, (tx) =>
      refreshSale(tx, r.store, r.saleId, fakeProvider, at(CARD_CHECK_INTERVAL_MS)),
    );
    vi.unstubAllEnvs();
    expect(view.status).toBe("awaiting_payment");
  });
});

describe("refreshSale with a Pix payment after phase 4", () => {
  it("records the reason when a Pix payment expires", async () => {
    const r = await awaiting("pix");
    const view = await r.refresh(at(4 * 60_000));
    expect(view.status).toBe("open");
    expect((await r.rows()).map((p) => [p.status, p.failure_reason])).toEqual([["expired", "expired"]]);
  });
});

describe("reconcilePending with a card payment", () => {
  it("pays a card sale whose approval webhook was lost", async () => {
    const r = await awaiting("card");
    buildFakeCardWebhook(r.externalId, { status: "confirmed" });
    expect(await reconcilePending(at(CARD_CHECK_INTERVAL_MS))).toBe(1);
    const [s] = await adminSql`select status from sales where id = ${r.saleId}`;
    expect(s.status).toBe("paid");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/domain/card-refresh.test.ts`
Expected: FAIL (`CARD_CHECK_INTERVAL_MS` não existe; `refreshSale` não conhece cartão).

- [ ] **Step 3: Reescrever `src/domain/refresh.ts`**

Substituir o arquivo inteiro por (a função `reopen` local já foi trocada por `reopenSale` na Tarefa 3):

```ts
import type { Tx } from "@/db/tenant";
import type { CardProvider } from "@/payments/card";
import { type PaymentProvider, type ChargeStatus, withTimeout } from "@/payments/provider";
import { getCardProvider } from "@/payments/registry";
import { confirmPayment, failPayment } from "./payments";
import { type SaleView, type TerminalCtx, getSaleView, lockSale, reopenSale } from "./sales";

export const CHECK_INTERVAL_MS = 10_000;
export const CARD_CHECK_INTERVAL_MS = 2_000;

type Charge = { status: ChargeStatus; amountCents: number; failureReason?: "declined" | "cancelled" };

/**
 * Runs on every read of a sale. Expires an abandoned cart and reconciles a pending payment with
 * its provider (Pix at most every CHECK_INTERVAL_MS, card every CARD_CHECK_INTERVAL_MS), covering a
 * lost webhook. An old QR or an unanswered card with nothing confirmed expires and the sale returns
 * to open with the cart intact; a payment that still arrives later is accepted by confirmPayment.
 * ponytail: the provider call runs inside the transaction (holding the sale lock).
 */
export async function refreshSale(
  tx: Tx,
  term: TerminalCtx,
  saleId: string,
  provider: PaymentProvider,
  now: Date,
  card?: CardProvider,
): Promise<SaleView> {
  const sale = await lockSale(tx, term, saleId, now);
  if (sale.status === "awaiting_payment") {
    const [p] = await tx`
      select id, method, external_id, expires_at, checked_at from payments
      where sale_id = ${sale.id} and status = 'pending'`;
    if (!p) {
      await reopenSale(tx, sale.id, now); // the last payment already expired or failed
    } else {
      const isCard = p.method === "card";
      const interval = isCard ? CARD_CHECK_INTERVAL_MS : CHECK_INTERVAL_MS;
      if (!p.checked_at || now.getTime() - (p.checked_at as Date).getTime() >= interval) {
        let source: CardProvider | undefined;
        let charge: Charge | null = null;
        try {
          if (isCard) {
            source = card ?? getCardProvider();
            charge = await withTimeout(source.getCharge(p.external_id as string));
          } else {
            charge = await withTimeout(provider.getCharge(p.external_id as string));
          }
        } catch {
          // provider down or unknown: keep waiting, or let an old charge expire below
        }
        await tx`update payments set checked_at = ${now} where id = ${p.id}`;
        if (charge?.status === "confirmed") {
          const result = await confirmPayment(tx, p.id as string, charge.amountCents, { source: "reconcile" }, now);
          if (result === "rejected") await reopenSale(tx, sale.id, now); // the payment was marked failed
        } else if (charge?.status === "failed") {
          await failPayment(tx, p.id as string, charge.failureReason ?? "declined", now);
        } else if (charge?.status === "expired" || (p.expires_at as Date) <= now) {
          if (source) {
            try {
              await withTimeout(source.cancelCardCharge(p.external_id as string)); // stop the machine waiting
            } catch {
              // best effort: the charge ran out anyway
            }
          }
          await failPayment(tx, p.id as string, "expired", now);
        }
      }
    }
  }
  return getSaleView(tx, sale.id);
}
```

- [ ] **Step 4: Rodar os testes, typecheck e suíte**

Run: `npx vitest run tests/domain tests/payments && npm run typecheck && npm test`
Expected: PASS; os testes de reconciliação do Pix continuam passando (10 s e comportamento iguais).

- [ ] **Step 5: Commit**

```bash
git add src/domain/refresh.ts tests/domain/card-refresh.test.ts
git commit -m "feat: reconcile card payments every 2 seconds and record failure reasons"
```

---

### Task 6: Webhook de cartão e rotas de desenvolvimento

**Files:**
- Modify: `src/payments/webhook.ts`
- Create: `src/app/api/webhooks/card/[provider]/route.ts`, `src/app/api/dev/fake-card/[externalId]/approve/route.ts`, `src/app/api/dev/fake-card/[externalId]/decline/route.ts`, `tests/payments/card-webhook.test.ts`, `tests/pdv/card-routes.test.ts`

**Interfaces:**
- Consumes: `failPayment`, `confirmPayment`, `CardProvider`, `getCardProvider`, `buildFakeCardWebhook`.
- Produces: `handleCardWebhook(providerName: string, headers: Headers, rawBody: string, now?: Date): Promise<{ status: number; body: { result: string } }>` com resultados `confirmed`, `already_confirmed`, `rejected`, `failed`, `ignored`, `unknown_payment`, `unknown_provider`, `invalid_webhook`; rotas `POST /api/webhooks/card/[provider]`, `POST /api/dev/fake-card/[externalId]/approve` e `/decline`.

- [ ] **Step 1: Escrever os testes (falham)**

Criar `tests/payments/card-webhook.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { adminSql } from "@/db/client";
import { withOrg } from "@/db/tenant";
import { startPayment } from "@/domain/payments";
import { addItemByBarcode } from "@/domain/sales";
import { buildFakeWebhook, fakeProvider } from "@/payments/fake";
import { buildFakeCardWebhook, fakeCardProvider } from "@/payments/fake-card";
import { handleCardWebhook, handleProviderWebhook } from "@/payments/webhook";
import { makeOrg, resetDb, seedSellable, seedStore } from "../helpers";

beforeEach(resetDb);

const NOW = new Date("2026-10-03T12:00:00Z");
const BARCODE = "7891000100103";

async function awaitingCard() {
  const orgId = await makeOrg("A");
  const store = await seedStore(orgId);
  await seedSellable(orgId, store.marketId, { barcode: BARCODE, priceCents: 500 });
  const sale = await withOrg(orgId, (tx) => addItemByBarcode(tx, orgId, store, { barcode: BARCODE }, NOW));
  const start = (method: "card" | "pix", now = NOW) =>
    withOrg(orgId, (tx) =>
      startPayment(tx, orgId, store, sale.id, fakeProvider, now, { method, card: fakeCardProvider }),
    );
  await start("card");
  const [p] = await adminSql`select external_id from payments where sale_id = ${sale.id}`;
  return { orgId, saleId: sale.id, externalId: p.external_id as string, start };
}
const movements = async (saleId: string) =>
  (await adminSql`select count(*)::int as n from stock_movements where sale_id = ${saleId}`)[0].n as number;
const sale = async (saleId: string) =>
  (await adminSql`select status from sales where id = ${saleId}`)[0].status as string;
const payments = (saleId: string) =>
  adminSql`select method, status, failure_reason from payments where sale_id = ${saleId} order by created_at, id`;
const hook = (r: { headers: Headers; rawBody: string }) => handleCardWebhook("fake", r.headers, r.rawBody, NOW);

describe("handleCardWebhook", () => {
  it("confirms an approval, pays the sale and takes stock out once", async () => {
    const { saleId, externalId } = await awaitingCard();
    const r = buildFakeCardWebhook(externalId, { status: "confirmed" });
    expect(await hook(r)).toEqual({ status: 200, body: { result: "confirmed" } });
    expect((await hook(r)).body.result).toBe("already_confirmed");
    expect(await sale(saleId)).toBe("paid");
    expect(await movements(saleId)).toBe(1);
  });

  it("puts the sale back at the cart when the card is declined, and ignores a repeat", async () => {
    const { saleId, externalId } = await awaitingCard();
    const r = buildFakeCardWebhook(externalId, { status: "failed", failureReason: "declined" });
    expect(await hook(r)).toEqual({ status: 200, body: { result: "failed" } });
    expect((await hook(r)).body.result).toBe("ignored");
    expect(await sale(saleId)).toBe("open");
    expect((await payments(saleId)).map((p) => [p.status, p.failure_reason])).toEqual([["failed", "declined"]]);
    expect(await movements(saleId)).toBe(0);
  });

  it("treats a failure without a reason as declined and an expiry as expired", async () => {
    const a = await awaitingCard();
    await hook(buildFakeCardWebhook(a.externalId, { status: "failed" }));
    expect((await payments(a.saleId)).map((p) => [p.status, p.failure_reason])).toEqual([["failed", "declined"]]);
    const b = await awaitingCard();
    await hook(buildFakeCardWebhook(b.externalId, { status: "expired" }));
    expect((await payments(b.saleId)).map((p) => [p.status, p.failure_reason])).toEqual([["expired", "expired"]]);
  });

  it("never reverts a confirmed payment when a decline arrives afterwards", async () => {
    const { saleId, externalId } = await awaitingCard();
    await hook(buildFakeCardWebhook(externalId, { status: "confirmed" }));
    const late = await hook(buildFakeCardWebhook(externalId, { status: "failed", failureReason: "declined" }));
    expect(late.body.result).toBe("ignored");
    expect(await sale(saleId)).toBe("paid");
    expect((await payments(saleId)).map((p) => p.status)).toEqual(["confirmed"]);
  });

  it("does not reopen a sale that already waits for another payment", async () => {
    const { saleId, externalId, start } = await awaitingCard();
    await start("pix", new Date(NOW.getTime() + 1000));
    const r = await hook(buildFakeCardWebhook(externalId, { status: "failed", failureReason: "declined" }));
    expect(r.body.result).toBe("ignored");
    expect(await sale(saleId)).toBe("awaiting_payment");
  });

  it("rejects an approval for the wrong amount, like the Pix path", async () => {
    const { externalId } = await awaitingCard();
    const r = await hook(buildFakeCardWebhook(externalId, { status: "confirmed", amountCents: 1 }));
    expect(r.body.result).toBe("rejected");
  });

  it("answers 401 to a bad signature or a body that is not JSON, 404 to unknown providers", async () => {
    const { externalId } = await awaitingCard();
    const { rawBody } = buildFakeCardWebhook(externalId, { status: "confirmed" });
    const bad = await handleCardWebhook("fake", new Headers({ "x-fake-signature": "00" }), rawBody, NOW);
    expect([bad.status, bad.body.result]).toEqual([401, "invalid_webhook"]);
    expect((await handleCardWebhook("fake", new Headers({ "x-fake-signature": "00" }), "not json", NOW)).status).toBe(401);
    for (const name of ["nope", "constructor", "__proto__"]) {
      const r = await handleCardWebhook(name, new Headers(), "{}", NOW);
      expect([r.status, r.body.result]).toEqual([404, "unknown_provider"]);
    }
  });

  it("answers 200 and ignores an unknown payment", async () => {
    await awaitingCard();
    const r = await hook(buildFakeCardWebhook("fakecard_unknown", { status: "confirmed" }));
    expect(r).toEqual({ status: 200, body: { result: "unknown_payment" } });
  });

  it("keeps the Pix and card paths apart: neither handler finds the other's payments", async () => {
    const { externalId } = await awaitingCard();
    const asPix = buildFakeWebhook(externalId);
    expect((await handleProviderWebhook("fake", asPix.headers, asPix.rawBody, NOW)).body.result).toBe("unknown_payment");
  });
});
```

Criar `tests/pdv/card-routes.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adminSql } from "@/db/client";
import { withOrg } from "@/db/tenant";
import { startPayment } from "@/domain/payments";
import { addItemByBarcode } from "@/domain/sales";
import { buildFakeCardWebhook, fakeCardProvider } from "@/payments/fake-card";
import { fakeProvider } from "@/payments/fake";
import { POST as approveRoute } from "@/app/api/dev/fake-card/[externalId]/approve/route";
import { POST as declineRoute } from "@/app/api/dev/fake-card/[externalId]/decline/route";
import { POST as cardWebhookRoute } from "@/app/api/webhooks/card/[provider]/route";
import { makeOrg, resetDb, seedSellable, seedStore } from "../helpers";

beforeEach(resetDb);
afterEach(() => vi.unstubAllEnvs());

const NOW = new Date("2026-10-03T12:00:00Z");
const ctx = <T extends object>(p: T) => ({ params: Promise.resolve(p) });
const post = () => new Request("http://m77.test/x", { method: "POST" });

async function awaitingCard() {
  const orgId = await makeOrg("A");
  const store = await seedStore(orgId);
  await seedSellable(orgId, store.marketId, { barcode: "B-1", priceCents: 500 });
  const sale = await withOrg(orgId, (tx) => addItemByBarcode(tx, orgId, store, { barcode: "B-1" }, NOW));
  await withOrg(orgId, (tx) =>
    startPayment(tx, orgId, store, sale.id, fakeProvider, NOW, { method: "card", card: fakeCardProvider }),
  );
  const [p] = await adminSql`select external_id from payments where sale_id = ${sale.id}`;
  const status = async () => (await adminSql`select status from sales where id = ${sale.id}`)[0].status as string;
  return { externalId: p.external_id as string, status };
}

describe("card webhook route", () => {
  it("answers 401 to a forged webhook and 404 to an unknown provider, and confirms a signed one", async () => {
    const { externalId, status } = await awaitingCard();
    const forged = new Request("http://m77.test/x", { method: "POST", headers: { "x-fake-signature": "00" }, body: "{}" });
    expect((await cardWebhookRoute(forged, ctx({ provider: "fake" }))).status).toBe(401);
    const unknown = new Request("http://m77.test/x", { method: "POST", body: "{}" });
    expect((await cardWebhookRoute(unknown, ctx({ provider: "constructor" }))).status).toBe(404);
    const { headers, rawBody } = buildFakeCardWebhook(externalId, { status: "confirmed" });
    const ok = await cardWebhookRoute(
      new Request("http://m77.test/x", { method: "POST", headers, body: rawBody }),
      ctx({ provider: "fake" }),
    );
    expect([ok.status, await ok.json()]).toEqual([200, { result: "confirmed" }]);
    expect(await status()).toBe("paid");
  });
});

describe("dev fake card routes", () => {
  it("approve pays the sale through the real webhook path", async () => {
    const { externalId, status } = await awaitingCard();
    const res = await approveRoute(post(), ctx({ externalId }));
    expect([res.status, await res.json()]).toEqual([200, { result: "confirmed" }]);
    expect(await status()).toBe("paid");
  });

  it("decline puts the sale back at the cart", async () => {
    const { externalId, status } = await awaitingCard();
    const res = await declineRoute(post(), ctx({ externalId }));
    expect([res.status, await res.json()]).toEqual([200, { result: "failed" }]);
    expect(await status()).toBe("open");
  });

  it("answer 404 in production", async () => {
    const { externalId } = await awaitingCard();
    vi.stubEnv("NODE_ENV", "production");
    expect((await approveRoute(post(), ctx({ externalId }))).status).toBe(404);
    expect((await declineRoute(post(), ctx({ externalId }))).status).toBe(404);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/payments/card-webhook.test.ts tests/pdv/card-routes.test.ts`
Expected: FAIL (`handleCardWebhook` e as rotas não existem).

- [ ] **Step 3: `src/payments/webhook.ts`**

No Pix, restringir a busca ao método: na consulta de `handleProviderWebhook`, trocar por:

```ts
  const [p] = await adminSql`
    select id, org_id from payments
    where provider = ${provider.name} and external_id = ${event.externalId} and method = 'pix'`;
```

Trocar o bloco de imports no topo por:

```ts
import { adminSql } from "@/db/client";
import { withOrg } from "@/db/tenant";
import { confirmPayment, failPayment } from "@/domain/payments";
import type { CardProvider } from "./card";
import type { PaymentProvider } from "./provider";
import { getCardProvider, getProvider } from "./registry";
```

e acrescentar ao fim do arquivo:

```ts
/**
 * Card provider callback. Like the Pix one (no session, signature first, adminSql only to learn the
 * organization), but a decline, cancellation or expiry also acts: the sale goes back to the cart at
 * once instead of waiting for the next reconciliation. Idempotent; a confirmed payment never changes.
 */
export async function handleCardWebhook(
  providerName: string,
  headers: Headers,
  rawBody: string,
  now: Date = new Date(),
): Promise<Outcome> {
  let provider: CardProvider;
  try {
    provider = getCardProvider(providerName);
  } catch {
    return { status: 404, body: { result: "unknown_provider" } };
  }
  let event: ReturnType<CardProvider["parseWebhook"]>;
  try {
    event = provider.parseWebhook(headers, rawBody);
  } catch {
    return { status: 401, body: { result: "invalid_webhook" } };
  }
  if (!event) return { status: 200, body: { result: "ignored" } };

  const [p] = await adminSql`
    select id, org_id from payments
    where provider = ${provider.name} and external_id = ${event.externalId} and method = 'card'`;
  if (!p) return { status: 200, body: { result: "unknown_payment" } };
  const orgId = p.org_id as string;
  if (event.status === "confirmed") {
    const result = await withOrg(orgId, (tx) =>
      confirmPayment(tx, p.id as string, event.amountCents, safeJson(rawBody), now),
    );
    return { status: 200, body: { result } };
  }
  const reason = event.status === "expired" ? "expired" : (event.failureReason ?? "declined");
  const changed = await withOrg(orgId, (tx) => failPayment(tx, p.id as string, reason, now));
  return { status: 200, body: { result: changed ? "failed" : "ignored" } };
}
```

- [ ] **Step 4: Criar as três rotas**

`src/app/api/webhooks/card/[provider]/route.ts`:

```ts
import { handleCardWebhook } from "@/payments/webhook";

export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const r = await handleCardWebhook(provider, req.headers, await req.text());
  return Response.json(r.body, { status: r.status });
}
```

`src/app/api/dev/fake-card/[externalId]/approve/route.ts`:

```ts
import { buildFakeCardWebhook } from "@/payments/fake-card";
import { handleCardWebhook } from "@/payments/webhook";

/** Dev only: the machine approves a charge, through the real webhook path. */
export async function POST(_req: Request, { params }: { params: Promise<{ externalId: string }> }) {
  if (process.env.NODE_ENV === "production") return new Response(null, { status: 404 });
  const { externalId } = await params;
  const { headers, rawBody } = buildFakeCardWebhook(externalId, { status: "confirmed" });
  const r = await handleCardWebhook("fake", headers, rawBody);
  return Response.json(r.body, { status: r.status });
}
```

`src/app/api/dev/fake-card/[externalId]/decline/route.ts`:

```ts
import { buildFakeCardWebhook } from "@/payments/fake-card";
import { handleCardWebhook } from "@/payments/webhook";

/** Dev only: the card is declined, through the real webhook path. */
export async function POST(_req: Request, { params }: { params: Promise<{ externalId: string }> }) {
  if (process.env.NODE_ENV === "production") return new Response(null, { status: 404 });
  const { externalId } = await params;
  const { headers, rawBody } = buildFakeCardWebhook(externalId, { status: "failed", failureReason: "declined" });
  const r = await handleCardWebhook("fake", headers, rawBody);
  return Response.json(r.body, { status: r.status });
}
```

- [ ] **Step 5: Rodar os testes, typecheck e suíte**

Run: `npx vitest run tests/payments tests/pdv && npm run typecheck && npm test`
Expected: PASS; os testes do webhook Pix continuam passando.

- [ ] **Step 6: Commit**

```bash
git add src/payments/webhook.ts src/app/api/webhooks/card src/app/api/dev/fake-card tests/payments/card-webhook.test.ts tests/pdv/card-routes.test.ts
git commit -m "feat: add the card webhook and dev routes to approve or decline a charge"
```

---

### Task 7: API do PDV (pagar com método, cancelar pagamento)

**Files:**
- Modify: `src/pdv/http.ts`
- Create: `src/app/api/pdv/sales/[id]/payment/cancel/route.ts`, `tests/pdv/card-handlers.test.ts`

**Interfaces:**
- Consumes: `startPayment` (com `opts.method`), `cancelPayment` (`@/domain/payments`), `parse` (`@/lib/validate`), `handle`, `errorResponse` (já em `src/pdv/http.ts`), `buildFakeCardWebhook`, `handleCardWebhook`.
- Produces: `payHandler(req, saleId, now?)` aceita corpo vazio (Pix) ou `{ method?: "pix" | "card" }`; `cancelPaymentHandler(req: Request, saleId: string, now?: Date): Promise<Response>`; rota `POST /api/pdv/sales/:id/payment/cancel`. As respostas são o `SaleView` JSON, com `payment.method`, `payment.qrPayload` (nulo no cartão), `payment.failureReason` e `paymentFailure`.

- [ ] **Step 1: Escrever os testes (falham)**

Criar `tests/pdv/card-handlers.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adminSql } from "@/db/client";
import { withOrg } from "@/db/tenant";
import { createTerminal } from "@/domain/terminals";
import { buildFakeCardWebhook } from "@/payments/fake-card";
import { handleCardWebhook } from "@/payments/webhook";
import { cancelPaymentHandler, getSaleHandler, payHandler, scanHandler } from "@/pdv/http";
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
const json = async (res: Response) => (await res.json()) as Record<string, any>;

async function setup() {
  const orgId = await makeOrg("A");
  const store = await seedStore(orgId);
  await seedSellable(orgId, store.marketId, { barcode: BARCODE, priceCents: 500 });
  const { token } = await withOrg(orgId, (tx) =>
    createTerminal(tx, orgId, { marketId: store.marketId, name: "Totem 1" }),
  );
  const sale = await json(await scanHandler(call(token, { barcode: BARCODE })));
  const externalId = async () =>
    (await adminSql`select external_id from payments where sale_id = ${sale.id} order by created_at desc limit 1`)[0]
      .external_id as string;
  const get = async () => json(await getSaleHandler(call(token), sale.id));
  return { orgId, store, token, saleId: sale.id as string, externalId, get };
}
type Setup = Awaited<ReturnType<typeof setup>>;
const payCard = (s: Setup) => payHandler(call(s.token, { method: "card" }), s.saleId);

describe("pay with a method", () => {
  it("starts a card payment: no QR, method card, two minutes to pay", async () => {
    const s = await setup();
    const res = await payCard(s);
    const view = await json(res);
    expect([res.status, view.status]).toEqual([200, "awaiting_payment"]);
    expect(view.payment).toMatchObject({ method: "card", status: "pending", qrPayload: null, amountCents: 500 });
    expect(typeof view.payment.expiresAt).toBe("string");
  });

  it("keeps Pix as the default for an empty body, an empty object and an explicit pix", async () => {
    for (const body of [undefined, {}, { method: "pix" }]) {
      const s = await setup();
      const view = await json(await payHandler(call(s.token, body), s.saleId));
      expect(view.payment.method).toBe("pix");
      expect(view.payment.qrPayload).toMatch(/^FAKEPIX\|/);
    }
  });

  it("answers 400 to an unknown method, a bad body type and broken JSON, never 500", async () => {
    const s = await setup();
    for (const [body, raw] of [[{ method: "boleto" }], [{ method: 1 }], [undefined, "null"], [undefined, "{"]] as const) {
      const res = await payHandler(call(s.token, body, raw), s.saleId);
      expect([res.status, (await json(res)).error]).toEqual([400, "invalid_input"]);
    }
  });

  it("answers 503 provider_unavailable when the card charge cannot be created", async () => {
    const s = await setup();
    vi.stubEnv("FAKE_CARD_SECRET", "");
    const res = await payCard(s);
    expect([res.status, (await json(res)).error]).toEqual([503, "provider_unavailable"]);
    vi.unstubAllEnvs();
    expect((await s.get()).status).toBe("open");
  });

  it("answers 503 for an unknown card provider in the environment", async () => {
    const s = await setup();
    vi.stubEnv("CARD_PROVIDER", "nope");
    const res = await payCard(s);
    expect([res.status, (await json(res)).error]).toEqual([503, "provider_unavailable"]);
  });
});

describe("card outcomes seen by the totem", () => {
  it("shows the sale paid after the machine approves", async () => {
    const s = await setup();
    await payCard(s);
    const { headers, rawBody } = buildFakeCardWebhook(await s.externalId(), { status: "confirmed" });
    expect((await handleCardWebhook("fake", headers, rawBody)).body.result).toBe("confirmed");
    expect((await s.get()).status).toBe("paid");
  });

  it("shows the cart again, with the reason, after a decline, and lets the customer pay with Pix", async () => {
    const s = await setup();
    await payCard(s);
    const { headers, rawBody } = buildFakeCardWebhook(await s.externalId(), { status: "failed", failureReason: "declined" });
    await handleCardWebhook("fake", headers, rawBody);
    const view = await s.get();
    expect(view.status).toBe("open");
    expect(view.paymentFailure).toEqual({ method: "card", reason: "declined" });
    expect(view.payment.failureReason).toBe("declined");
    const pix = await json(await payHandler(call(s.token), s.saleId));
    expect([pix.status, pix.payment.method, pix.paymentFailure]).toEqual(["awaiting_payment", "pix", null]);
  });
});

describe("cancel payment", () => {
  it("puts the sale back at the cart, keeps the items, and is idempotent", async () => {
    const s = await setup();
    await payCard(s);
    const res = await cancelPaymentHandler(call(s.token), s.saleId);
    const view = await json(res);
    expect([res.status, view.status, view.items.length]).toEqual([200, "open", 1]);
    expect(view.paymentFailure).toEqual({ method: "card", reason: "cancelled" });
    const again = await cancelPaymentHandler(call(s.token), s.saleId);
    expect([again.status, (await json(again)).status]).toEqual([200, "open"]);
    const next = await json(await payCard(s));
    expect(next.status).toBe("awaiting_payment");
  });

  it("answers 409 for a paid sale", async () => {
    const s = await setup();
    await payCard(s);
    const { headers, rawBody } = buildFakeCardWebhook(await s.externalId(), { status: "confirmed" });
    await handleCardWebhook("fake", headers, rawBody);
    const res = await cancelPaymentHandler(call(s.token), s.saleId);
    expect([res.status, (await json(res)).error]).toEqual([409, "sale_not_editable"]);
  });

  it("keeps the payment pending and answers 503 when the machine cannot be told to stop", async () => {
    const s = await setup();
    await payCard(s);
    vi.stubEnv("FAKE_CARD_SECRET", "");
    const res = await cancelPaymentHandler(call(s.token), s.saleId);
    expect([res.status, (await json(res)).error]).toEqual([503, "provider_unavailable"]);
    vi.unstubAllEnvs();
    expect((await s.get()).status).toBe("awaiting_payment");
  });

  it("answers 401 without a token, and 404 for malformed ids and for another terminal or organization", async () => {
    const s = await setup();
    await payCard(s);
    expect((await cancelPaymentHandler(call(undefined), s.saleId)).status).toBe(401);
    expect((await cancelPaymentHandler(call(s.token), "nope")).status).toBe(404);
    const second = await withOrg(s.orgId, (tx) =>
      createTerminal(tx, s.orgId, { marketId: s.store.marketId, name: "Totem 2" }),
    );
    expect((await cancelPaymentHandler(call(second.token), s.saleId)).status).toBe(404);
    const other = await setup();
    expect((await cancelPaymentHandler(call(other.token), s.saleId)).status).toBe(404);
    expect((await s.get()).status).toBe("awaiting_payment");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/pdv/card-handlers.test.ts`
Expected: FAIL (`cancelPaymentHandler` não existe; `payHandler` ignora o corpo).

- [ ] **Step 3: Alterar `src/pdv/http.ts`**

No bloco de imports, acrescentar `import { z } from "zod";` e `import { parse } from "@/lib/validate";`, e trocar `import { startPayment } from "@/domain/payments";` por `import { cancelPayment, startPayment } from "@/domain/payments";`.

Substituir a definição de `payHandler` por:

```ts
const PayInput = z.object({ method: z.enum(["pix", "card"]).optional() });

/** An optional JSON body: empty means {}; broken JSON is invalid_input. */
async function optionalBody(req: Request): Promise<unknown> {
  const text = await req.text();
  if (text.trim() === "") return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError("invalid_input");
  }
}

export const payHandler = (req: Request, saleId: string, now: Date = new Date()) =>
  handle(req, async (t) => {
    const { method } = parse(PayInput, await optionalBody(req));
    return withOrg(t.orgId, (tx) => startPayment(tx, t.orgId, ctx(t), saleId, getProvider(), now, { method }));
  });

export const cancelPaymentHandler = (req: Request, saleId: string, now: Date = new Date()) =>
  handle(req, (t) => withOrg(t.orgId, (tx) => cancelPayment(tx, ctx(t), saleId, now)));
```

- [ ] **Step 4: Criar a rota**

`src/app/api/pdv/sales/[id]/payment/cancel/route.ts`:

```ts
import { cancelPaymentHandler } from "@/pdv/http";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return cancelPaymentHandler(req, (await params).id);
}
```

- [ ] **Step 5: Rodar os testes, typecheck e suíte**

Run: `npx vitest run tests/pdv && npm run typecheck && npm test`
Expected: PASS; os testes de `pay` do Pix existentes (sem corpo) continuam passando.

- [ ] **Step 6: Commit**

```bash
git add src/pdv/http.ts "src/app/api/pdv/sales/[id]/payment" tests/pdv/card-handlers.test.ts
git commit -m "feat: let the PDV pay with a method and cancel a pending payment"
```

---

### Task 8: Tela do totem (pagar com cartão)

**Files:**
- Create: `src/pdv/notice.ts`, `tests/pdv/notice.test.ts`
- Modify: `src/app/pdv/PdvApp.tsx`

**Interfaces:**
- Consumes: o JSON do PDV da Tarefa 7 (`payment.method`, `payment.qrPayload` nulo, `paymentFailure`).
- Produces: `paymentNotice(sale: { payment: { method: string; status: string } | null; paymentFailure: { method: string; reason: string } | null }): string | null` em `src/pdv/notice.ts`.

- [ ] **Step 1: Escrever o teste (falha)**

Criar `tests/pdv/notice.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { paymentNotice } from "@/pdv/notice";

const sale = (payment: { method: string; status: string } | null, paymentFailure: { method: string; reason: string } | null) => ({
  payment,
  paymentFailure,
});

describe("paymentNotice", () => {
  it("tells the customer a card was declined and how to go on", () => {
    expect(paymentNotice(sale({ method: "card", status: "failed" }, { method: "card", reason: "declined" }))).toBe(
      "Cartão recusado. Tente de novo ou pague com Pix.",
    );
  });

  it("tells the customer the time on the machine ran out", () => {
    expect(paymentNotice(sale({ method: "card", status: "expired" }, { method: "card", reason: "expired" }))).toBe(
      "Tempo esgotado na maquininha.",
    );
  });

  it("says nothing when the customer cancelled the card payment or nothing failed", () => {
    expect(paymentNotice(sale({ method: "card", status: "expired" }, { method: "card", reason: "cancelled" }))).toBeNull();
    expect(paymentNotice(sale(null, null))).toBeNull();
    expect(paymentNotice(sale({ method: "card", status: "pending" }, null))).toBeNull();
  });

  it("keeps the Pix message for an expired QR, and ignores Pix failures of other kinds", () => {
    expect(paymentNotice(sale({ method: "pix", status: "expired" }, { method: "pix", reason: "expired" }))).toBe(
      "O QR expirou. Gere um novo para pagar.",
    );
    expect(paymentNotice(sale({ method: "pix", status: "expired" }, null))).toBe("O QR expirou. Gere um novo para pagar.");
    expect(paymentNotice(sale({ method: "pix", status: "failed" }, { method: "pix", reason: "declined" }))).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/pdv/notice.test.ts`
Expected: FAIL com `Cannot find module '@/pdv/notice'`.

- [ ] **Step 3: Implementar `src/pdv/notice.ts`**

```ts
type NoticeSale = {
  payment: { method: string; status: string } | null;
  paymentFailure: { method: string; reason: string } | null;
};

/** The message the cart shows after a payment did not go through, or null for none. */
export function paymentNotice(sale: NoticeSale): string | null {
  const f = sale.paymentFailure;
  if (f?.method === "card") {
    if (f.reason === "declined") return "Cartão recusado. Tente de novo ou pague com Pix.";
    if (f.reason === "expired") return "Tempo esgotado na maquininha.";
    return null; // the customer cancelled: no warning
  }
  if (sale.payment && sale.payment.method !== "card" && sale.payment.status === "expired") {
    return "O QR expirou. Gere um novo para pagar.";
  }
  return null;
}
```

- [ ] **Step 4: Ajustar `src/app/pdv/PdvApp.tsx`**

Acrescentar `import { paymentNotice } from "@/pdv/notice";` ao grupo de imports. Alterações:

1. Substituir os tipos `Payment` e `Sale` por:

```tsx
type Payment = { status: string; method: string; qrPayload: string | null; expiresAt: string } | null;
type PaymentFailure = { method: string; reason: string } | null;
type Sale = {
  id: string;
  status: string;
  totalCents: number;
  items: Item[];
  payment: Payment;
  paymentFailure: PaymentFailure;
};
```

2. Acrescentar ao grupo de estados, depois de `const [draft, setDraft] = useState("");`:

```tsx
  const [cancelling, setCancelling] = useState(false);
```

3. Substituir a linha `const payload = ...` por (o QR só existe no Pix):

```tsx
  const payload =
    sale?.status === "awaiting_payment" && sale.payment?.method !== "card"
      ? (sale.payment?.qrPayload ?? undefined)
      : undefined;
```

4. Substituir a função `startPay` e acrescentar `cancelCardPayment` logo depois:

```tsx
  async function startPay(method: "pix" | "card") {
    if (!sale) return;
    try {
      payingRef.current = true;
      const r = await run("POST", `/sales/${sale.id}/pay`, { method });
      if (r?.ok) applySale(r.data as Sale);
      else if (r) flash(r.data.message ?? "Erro inesperado.");
    } finally {
      payingRef.current = false;
    }
  }

  async function cancelCardPayment() {
    if (!sale || cancelling) return;
    setCancelling(true);
    try {
      const r = await run("POST", `/sales/${sale.id}/payment/cancel`);
      if (r?.ok) applySale(r.data as Sale);
      else if (r) flash(r.data.message ?? "Erro inesperado.");
    } finally {
      setCancelling(false);
    }
  }
```

5. Inserir, ANTES do bloco `if (sale.status === "awaiting_payment") {` (o do Pix), a tela do cartão:

```tsx
  if (sale.status === "awaiting_payment" && sale.payment?.method === "card") {
    const left = Math.max(0, Math.round((new Date(sale.payment.expiresAt).getTime() - now) / 1000));
    return (
      <Screen title={`Pague ${formatBRL(sale.totalCents)} no cartão`}>
        <p>Siga as instruções na maquininha.</p>
        <p>
          Tempo restante: {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
        </p>
        {notice && <p role="alert">{notice}</p>}
        <button style={bigButton} onClick={cancelCardPayment} disabled={cancelling}>
          Cancelar
        </button>
      </Screen>
    );
  }
```

6. No carrinho, trocar a linha `{sale.payment?.status === "expired" && <p role="alert">O QR expirou. Gere um novo para pagar.</p>}` por:

```tsx
      {paymentNotice(sale) && <p role="alert">{paymentNotice(sale)}</p>}
```

7. No carrinho, trocar o botão único "Pagar com Pix" por dois:

```tsx
      <button style={bigButton} onClick={() => startPay("pix")} disabled={sale.items.length === 0}>
        Pagar com Pix
      </button>
      <button style={bigButton} onClick={() => startPay("card")} disabled={sale.items.length === 0}>
        Pagar com cartão
      </button>
```

(o botão "Cancelar" do carrinho, que cancela a venda, continua como está).

- [ ] **Step 5: Rodar os testes, typecheck e build**

Run: `npx vitest run tests/pdv/notice.test.ts && npm run typecheck && npm run build && npm test`
Expected: PASS, sem erros de tipo, o build lista `/pdv`.

- [ ] **Step 6: Commit**

```bash
git add src/pdv/notice.ts src/app/pdv/PdvApp.tsx tests/pdv/notice.test.ts
git commit -m "feat: add card payment to the totem screen"
```

---

### Task 9: Painel do dono (método e motivo nas vendas)

**Files:**
- Modify: `src/app/o/[orgId]/sales/[saleId]/page.tsx`

**Interfaces:**
- Consumes: `SaleDetail.payments[]` com `method` e `failureReason` (Tarefa 3), `METHOD_LABEL`, `FAILURE_LABEL`, `PAYMENT_LABEL`.
- Produces: o detalhe da venda mostra o método e o motivo de cada pagamento. A lista de vendas já usa o novo `needsAttention` (Tarefa 3).

A lógica está coberta pelos testes da Tarefa 3; esta tarefa é só interface. Verificação: typecheck, build e o roteiro da Tarefa 10.

- [ ] **Step 1: Atualizar o detalhe da venda**

Em `src/app/o/[orgId]/sales/[saleId]/page.tsx`, trocar o import de rótulos por `import { FAILURE_LABEL, METHOD_LABEL, PAYMENT_LABEL, STATUS_LABEL } from "@/lib/labels";` e substituir o `<li>` de cada pagamento por:

```tsx
          <li key={p.id}>
            {METHOD_LABEL[p.method] ?? p.method}, {PAYMENT_LABEL[p.status] ?? p.status}
            {p.failureReason && <> ({FAILURE_LABEL[p.failureReason] ?? p.failureReason})</>}: esperado{" "}
            {formatBRL(p.amountCents)}
            {p.paidAmountCents !== null && <>, recebido {formatBRL(p.paidAmountCents)}</>}
            {p.status === "failed" && !p.failureReason && (
              <strong> (requer atenção: verifique com o provedor)</strong>
            )}
          </li>
```

- [ ] **Step 2: Typecheck e build**

Run: `npm run typecheck && npm run build`
Expected: sem erros; o build lista `/o/[orgId]/sales/[saleId]`.

- [ ] **Step 3: Commit**

```bash
git add "src/app/o/[orgId]/sales/[saleId]/page.tsx"
git commit -m "feat: show payment method and failure reason in the owner panel"
```

---

### Task 10: Documentação e verificação final

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: tudo das Tarefas 1 a 9.

- [ ] **Step 1: Atualizar o `README.md`**

Acrescentar, depois da seção "Agente do totem (fase 3)" e antes de "Testes":

````markdown
## Cartão (fase 4)

O totem tem os botões **Pagar com Pix** e **Pagar com cartão**. No cartão a tela pede para seguir as instruções na maquininha (2 minutos), com o botão **Cancelar**. Aprovação paga a venda e baixa o estoque como no Pix; recusa, cancelamento e tempo esgotado devolvem o carrinho com o motivo.

Ainda não há maquininha real escolhida: em desenvolvimento o cartão é simulado (`CARD_PROVIDER=fake`). Para "passar o cartão" de uma cobrança, pegue o identificador do pagamento (`select external_id from payments order by created_at desc limit 1`) e use:

```bash
curl -X POST http://localhost:3000/api/dev/fake-card/<identificador>/approve
curl -X POST http://localhost:3000/api/dev/fake-card/<identificador>/decline
```

Variáveis: `CARD_PROVIDER=fake` e `FAKE_CARD_SECRET` (assinatura do webhook simulado). O webhook do provedor de cartão é `POST /api/webhooks/card/<provedor>`. O adaptador `fake` de cartão e as rotas `/api/dev/fake-card` recusam funcionar com `NODE_ENV=production`.

Um adaptador real implementa a interface `CardProvider` (`src/payments/card.ts`) e passa na suíte de contrato `tests/payments/card-contract.ts`. Se a maquininha escolhida exigir SDK local, será preciso uma ponte pelo agente do totem (fase própria).
````

- [ ] **Step 2: Verificação automática completa**

Run: `npm run typecheck && npm test && npm run build`
Expected: tudo passa. Registre a contagem de arquivos e de testes.

- [ ] **Step 3: Roteiro HTTP com servidor real**

Com `docker compose up -d`, `.env` completo (inclui `CARD_PROVIDER` e `FAKE_CARD_SECRET`), `npm run db:migrate` e `npm run dev -- -p 3457` em segundo plano. Crie os dados com um script descartável FORA do repositório (pasta de rascunho da sessão; apague-o depois). Ele deve fechar os dois pools no fim, senão o processo não termina:

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
  const other = await withOrg(owner.orgId, (tx) =>
    createTerminal(tx, owner.orgId, { marketId: market.id, name: "Totem 2" }),
  );
  await addMember(owner.orgId, { email: `rep${s}@x.com`, password: "senha-rep-123", role: "restocker" });
  const stranger = await signUp({ email: `bia${s}@x.com`, password: "senha-bia-123", orgName: "Bia" });
  console.log(JSON.stringify({
    org: owner.orgId, terminal: term.token, other: other.token, owner: owner.token, stranger: stranger.token,
  }));
  await adminSql.end();
  await appSql.end();
})();
```

Executar com `npx tsx --env-file=.env <script>`. Depois, com `curl` (substituindo os valores impressos; `T` é o token do totem; cada item cria uma venda nova com `POST /api/pdv/sales/items` e `{"barcode":"7891000100103"}`), conferir e registrar o comando e a saída crua de cada item. O identificador do pagamento sai de `docker compose exec db psql -U market77 market77 -Atc "select external_id from payments where sale_id = '<id da venda>' order by created_at desc limit 1"`:

1. `POST /api/pdv/sales/<id>/pay` com `{"method":"card"}` retorna 200, `status: "awaiting_payment"`, `payment.method: "card"`, `payment.qrPayload: null` e `payment.expiresAt` cerca de 2 minutos adiante.
2. `POST /api/dev/fake-card/<identificador>/approve` retorna `{"result":"confirmed"}`; repetir retorna `{"result":"already_confirmed"}`; `GET /api/pdv/sales/<id>` retorna `status: "paid"`.
3. Em outra venda, pagar com cartão e `POST /api/dev/fake-card/<identificador>/decline` retorna `{"result":"failed"}`; `GET` da venda retorna `status: "open"` e `paymentFailure: {"method":"card","reason":"declined"}`; depois `pay` sem corpo retorna 200 com `payment.method: "pix"` e `qrPayload` começando com `FAKEPIX|`.
4. Em outra venda, pagar com cartão e `POST /api/pdv/sales/<id>/payment/cancel` retorna 200 com `status: "open"` e `paymentFailure.reason: "cancelled"`; repetir o cancelamento retorna 200 com `status: "open"`; `pay` com cartão de novo retorna 200.
5. Em outra venda, `pay` com `{"method":"pix"}` e depois `pay` com `{"method":"card"}` retorna `payment.method: "card"`; a consulta SQL `select method, status, failure_reason from payments where sale_id = '<id>' order by created_at` mostra o Pix `expired`/`cancelled` e o cartão `pending`.
6. Entradas ruins nunca dão 500: `pay` com `{"method":"boleto"}` retorna 400; `pay` com corpo `{` retorna 400; `payment/cancel` de `nope` retorna 404; `payment/cancel` sem `Authorization` retorna 401.
7. Isolamento: `payment/cancel` de uma venda do totem 1 com o token do totem 2 (`other`) retorna 404 e a venda não muda; com um token inválido retorna 401. Com o cookie do estranho (`m77_session=<stranger>`), `GET /o/<org>/sales/<id>` retorna 404 e a resposta não contém "Mercados Ana".
8. Webhook de cartão: `POST /api/webhooks/card/fake` com `x-fake-signature: 00` e corpo `{}` retorna 401; `POST /api/webhooks/card/constructor` retorna 404.
9. Painel com o cookie `m77_session=<owner>`: `GET /o/<org>/sales/<id da venda recusada do item 3>` retorna 200 e contém "Cartão" e "Recusado"; `GET /o/<org>/sales` retorna 200 e a venda do item 3, depois de paga por Pix pelo `fake-pix`, NÃO contém "requer atenção" (pague com `POST /api/dev/fake-pix/<identificador do Pix>/pay`).
10. Reiniciar o servidor e repetir `GET /api/pdv/sales/<id>` do item 2 e `GET /o/<org>/sales` do dono: continuam 200 (o estado fica no banco).

Encerrar o servidor por completo (`pkill -f "next dev"`), apagar o script descartável e conferir que nada ficou rodando (`pgrep -fl "next|tsx"` vazio) e que `git status` está limpo.

- [ ] **Step 4: Roteiro manual no navegador (feito pelo dono do projeto; o implementador não tem navegador)**

1. Abrir `/pdv` com o token do totem, escanear um produto e tocar em **Pagar com cartão**: aparece "Siga as instruções na maquininha" com a contagem de 2 minutos e o botão **Cancelar**.
2. Rodar o `curl .../approve` com o identificador do pagamento: a tela vai a "Obrigado!" e volta à inicial.
3. Repetir e rodar o `curl .../decline`: o carrinho volta com "Cartão recusado. Tente de novo ou pague com Pix."; tocar em **Pagar com Pix** gera o QR normalmente.
4. Repetir e tocar em **Cancelar** na tela do cartão: volta ao carrinho sem aviso.
5. Repetir e esperar os 2 minutos sem aprovar: o carrinho volta com "Tempo esgotado na maquininha." e **Pagar com cartão** gera uma nova cobrança.
6. No painel, **Vendas**: o detalhe de cada venda mostra o método (Pix ou Cartão) e o motivo ("Recusado", "Cancelado", "Expirado"); uma venda cujo cartão foi recusado e depois paga por Pix não aparece como "requer atenção".

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: document phase 4 card payments and the simulated adapter"
```

---

## Auto-revisão

**Cobertura do spec:** seção 3 (dados) na Tarefa 1; seção 4 (contrato e simulador) na Tarefa 2; seção 5 (domínio: `startPayment`, `cancelPayment`, `failPayment`, `refreshSale`, webhook, varredura) nas Tarefas 4, 5 e 6 (a varredura `reconcile.ts` não muda de código porque `refreshSale` escolhe o provedor pelo método, com teste na Tarefa 5); seção 6 (API do PDV, webhook, rotas de desenvolvimento, variáveis) nas Tarefas 1, 6 e 7; seção 7 (tela) na Tarefa 8; seção 8 (painel) nas Tarefas 3 e 9; seção 9 (erros e bordas) distribuída nos testes das Tarefas 4 a 7; seção 10 (testes) distribuída, com o roteiro manual na Tarefa 10.

**Decisões do plano que o spec não fixava, a confirmar na revisão:**
- `startPayment` e `refreshSale` ganham parâmetros opcionais no fim (`opts` e `card`) em vez de receber um objeto de provedores: os 15 pontos de chamada de Pix existentes ficam intactos e o padrão de cartão vem de `getCardProvider()`.
- Trocar de cartão para Pix com a maquininha fora do ar falha com `provider_unavailable` e mantém o cartão pendente (como o cancelamento), em vez de ignorar o erro: a máquina ainda poderia cobrar.
- A lista de vendas do painel passa a marcar "requer atenção" só pagamentos `failed` sem motivo (rejeitados pelo `confirmPayment`); uma recusa de cartão que o cliente resolveu pagando com Pix deixa de aparecer como alerta. O spec não dizia isso explicitamente.
