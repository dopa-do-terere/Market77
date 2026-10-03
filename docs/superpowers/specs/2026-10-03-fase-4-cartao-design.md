# Market77: fase 4, cartão na maquininha (adaptador simulado)

Data: 2026-10-03
Status: aguardando revisão do usuário
Base: `docs/superpowers/specs/2026-10-01-market77-design.md` (seções 2, 3, 5 e 8), a fase 2 (venda e Pix) e a fase 3 (agente do totem), já em `main`.

## 1. Objetivo

O cliente do totem escolhe **Pagar com cartão**, passa o cartão na maquininha e, na aprovação, a venda é paga e o estoque baixa sozinho, exatamente como no Pix. A maquininha real ainda não foi escolhida, então esta fase entrega o fluxo completo (servidor, PDV e painel) sobre um **adaptador simulado**, que roda e testa sem hardware. O adaptador real entra depois, atrás do mesmo contrato.

Fora desta fase: ponte do agente com um SDK local de maquininha (só será necessária se o modelo escolhido não for em nuvem, e terá spec própria, porque o heartbeat de 30 s é lento demais para um cliente esperando), escolha e integração de um provedor real, credenciais por organização (`provider_credentials`), estorno e devolução, parcelamento, bandeira e tipo de cartão (débito ou crédito é escolhido na maquininha), NFC-e, lote e validade.

## 2. Decisões

| Tema | Decisão |
|---|---|
| Integração | Do lado do servidor: a API cria a cobrança no provedor de cartão e recebe a confirmação por webhook ou consulta, como no Pix. O agente do totem não participa nesta fase |
| Contrato | Interface separada `CardProvider`, ao lado do `PaymentProvider` do Pix. Os dois usam a mesma tabela `payments`, o mesmo `confirmPayment`, a mesma reconciliação |
| Um pagamento por vez | Só um pagamento pendente por venda. Trocar de método cancela o pendente do outro |
| Tempo no cartão | 2 minutos para o cliente passar o cartão (`CARD_TTL_MS`) |
| Consulta ao provedor | Para cartão, no máximo a cada 2 segundos por pagamento (`CARD_CHECK_INTERVAL_MS`). O Pix continua com 10 segundos |
| Recusa, cancelamento, expiração | A venda volta sozinha para `open` com o carrinho preservado, e o PDV mostra o motivo |
| Pagamento tardio | Vale a regra da fase 2: um pagamento confirmado que chega depois ainda confirma, se o valor bater e a venda não estiver cancelada nem paga |
| Simulador | `fake-card`, só em desenvolvimento e teste (recusa funcionar com `NODE_ENV=production`), como o `fake` do Pix |

## 3. Modelo de dados (migration `0005_card.sql`)

**`payments`**:
- `method` passa a aceitar `'pix'` e `'card'` (a constraint `payments_method_check` é recriada).
- `qr_payload` deixa de ser `NOT NULL`. Uma constraint nova garante que um pagamento Pix sempre tenha QR: `CHECK (method <> 'pix' OR qr_payload IS NOT NULL)`.
- Coluna nova `failure_reason text` com `CHECK (failure_reason IN ('declined', 'cancelled', 'expired'))`, nula enquanto o pagamento não falhou.
- O índice `payments_one_pending_idx` (um pendente por venda) continua valendo para os dois métodos.

Nenhuma tabela nova, nenhuma permissão nova.

## 4. Contrato `CardProvider` (`src/payments/card.ts`)

```ts
export type CardFailure = "declined" | "cancelled";

export interface CardProvider {
  name: string;
  createCardCharge(i: { saleId: string; amountCents: number; terminalId: string; expiresAt: Date }):
    Promise<{ externalId: string; expiresAt: Date }>;
  /** Tells the machine to stop waiting. Idempotent. */
  cancelCardCharge(externalId: string): Promise<void>;
  getCharge(externalId: string):
    Promise<{ status: ChargeStatus; amountCents: number; failureReason?: CardFailure }>;
  /** Verifies the signature (throws when invalid). Returns null for events we do not care about. */
  parseWebhook(headers: Headers, rawBody: string):
    { externalId: string; status: "confirmed" | "expired" | "failed"; amountCents: number; failureReason?: CardFailure } | null;
}
```

`ChargeStatus` é o mesmo do Pix. Uma recusa ou um cancelamento na maquininha é `failed` com o motivo. Os provedores de cartão ficam num registro próprio (`getCardProvider(name)`, nome vindo de `CARD_PROVIDER`, padrão `fake`, com a mesma proteção `Object.hasOwn` do registro do Pix). Chamadas ao provedor usam `withTimeout`, como no Pix.

**Adaptador `fake-card`** (`src/payments/fake-card.ts`): o estado das cobranças fica em memória (só desenvolvimento e teste). Segredo `FAKE_CARD_SECRET` para assinar o webhook. `cancelCardCharge` marca a cobrança como `failed` com `cancelled`. Uma função `buildFakeCardWebhook(externalId, { status, failureReason })` monta o corpo assinado, como `buildFakeWebhook` do Pix.

## 5. Domínio

**`startPayment`** (em `src/domain/payments.ts`) ganha o método (`pix` ou `card`) e recebe os provedores dos dois tipos. Regras:
- Se já existe um pagamento pendente e ainda válido **do mesmo método**, ele é devolvido como está (comportamento atual).
- Se o pendente é **de outro método**, ele é encerrado antes de criar o novo: o pagamento vira `expired` com `failure_reason = 'cancelled'` e, se era cartão, `cancelCardCharge` é chamado.
- Cartão cria a cobrança com `CARD_TTL_MS` e grava `qr_payload = null`.
- Falha do provedor continua virando `provider_unavailable`, sem deixar a venda em estado inconsistente.

**`cancelPayment`** (novo, mesmo arquivo): cancela o pagamento pendente a pedido do cliente.
- Cartão: chama `cancelCardCharge`. Se a chamada falhar, responde `provider_unavailable` e **o pagamento continua pendente** (a máquina pode ainda cobrar; a venda não é liberada). Se a chamada der certo, consulta `getCharge`: se a cobrança já estava aprovada, executa `confirmPayment` (a venda fica paga e a resposta mostra isso); senão marca `expired` com `cancelled`.
- Pix: marca `expired` com `cancelled`.
- A venda volta para `open` com o carrinho. Idempotente: venda já `open` devolve a venda; venda `paid`, `cancelled` ou `expired` responde `sale_not_editable`.

**`failPayment`** (novo): marca um pagamento pendente como `failed` ou `expired` com um motivo e devolve a venda para `open`. Só age sobre pagamento `pending` (idempotente) e é usado pelo webhook de cartão e pela reconciliação.

**`refreshSale`** (`src/domain/refresh.ts`) passa a achar o provedor pelo método do pagamento pendente. Para cartão consulta no máximo a cada `CARD_CHECK_INTERVAL_MS`, e os estados `failed` e `expired` do provedor viram `failPayment` com o motivo que ele informar (`declined` por padrão para `failed`). Pix mantém o comportamento atual, mas também passa a gravar `failure_reason` (`expired` ou `declined`) quando um pagamento falha ou expira. Sempre que a venda volta a `open` por falha, o motivo fica em `payments.failure_reason`.

**Webhook** (`src/payments/webhook.ts`): `handleProviderWebhook` ganha o tipo (`pix` ou `card`) para escolher o registro certo. Para cartão, além de `confirmed` (que segue para `confirmPayment`), os eventos `failed` e `expired` agora são tratados com `failPayment`, para a recusa aparecer na tela em menos de 2 segundos, sem esperar a consulta. Para Pix, `failed` e `expired` continuam ignorados, como hoje. Assinatura inválida continua 401, provedor desconhecido 404, pagamento desconhecido 200 `unknown_payment`.

**Varredura** (`src/payments/reconcile.ts`): passa a resolver o provedor pelo método de cada venda, não mais um provedor global.

## 6. API do PDV

Mesma autenticação do totem (`requireTerminal`), mesmas regras de erro (entradas ruins nunca dão 500).

- `POST /api/pdv/sales/:id/pay` aceita `{ "method": "pix" | "card" }`. Sem corpo ou sem `method` continua sendo Pix, então o PDV atual não quebra. Método desconhecido responde 400 `invalid_input`. O `payment` da resposta ganha `method`; `qrPayload` é nulo no cartão.
- `POST /api/pdv/sales/:id/payment/cancel` (novo): chama `cancelPayment` e devolve a venda.
- `GET /api/pdv/sales/:id` (o polling que já existe) devolve também `paymentFailure: { method, reason } | null`: o último pagamento da venda, se a venda está `open` e esse pagamento falhou. Os motivos são `declined`, `cancelled` e `expired`. Fica nulo assim que um novo pagamento começa.
- `POST /api/webhooks/card/[provider]` (novo), mesmo tratamento do webhook do Pix.
- Rotas de desenvolvimento, 404 em produção: `POST /api/dev/fake-card/[externalId]/approve` e `/decline`, que montam o webhook assinado e o enviam pelo caminho real.
- Mensagens novas em `src/lib/messages.ts` e entradas em `STATUS` de `src/pdv/http.ts` quando necessário (os códigos usados já existem: `provider_unavailable`, `sale_not_editable`, `invalid_input`).
- Variáveis novas no `.env.example`, em `vitest.config.ts` e no README: `CARD_PROVIDER=fake` e `FAKE_CARD_SECRET`.

## 7. Tela do totem (`src/app/pdv/PdvApp.tsx`)

- O carrinho ganha dois botões: **Pagar com Pix** e **Pagar com cartão**.
- Tela do cartão: "Siga as instruções na maquininha", o valor, contagem regressiva de 2 minutos e o botão **Cancelar**, que chama `payment/cancel` e volta ao carrinho. Enquanto o cancelamento está em andamento o botão fica desabilitado. Se o cancelamento falhar com `provider_unavailable`, a tela continua e mostra o aviso.
- Recusado (`paymentFailure.reason = declined`): carrinho com "Cartão recusado. Tente de novo ou pague com Pix.". Tempo esgotado (`expired` no cartão): "Tempo esgotado na maquininha.". Cancelado: sem aviso. Aprovado: "Obrigado!", igual ao Pix.
- O comportamento do Pix (QR, contagem, "O QR expirou") não muda: o PDV usa `paymentFailure` só quando `method` é `card`.

## 8. Painel do dono

A lista e o detalhe de vendas mostram o método do pagamento (Pix ou Cartão) e, nos pagamentos que falharam ou expiraram, o motivo. Rótulos novos em `src/lib/labels.ts` (`METHOD_LABEL`, `FAILURE_LABEL`, em português). Nenhuma página nova.

## 9. Erros e casos de borda

- Cliente aperta Cancelar no instante em que a maquininha aprova: `cancelPayment` consulta o provedor depois de cancelar e confirma a venda em vez de descartar um pagamento aprovado.
- Provedor fora do ar ao cancelar: o pagamento segue pendente e o cliente vê o aviso; nada é liberado.
- Webhook de recusa duplicado ou fora de ordem (recusa depois de aprovação): `failPayment` só age sobre `pending`; um pagamento já `confirmed` nunca é revertido.
- Aprovação que chega depois de um cancelamento local: aceita pela regra de pagamento tardio, se o valor ainda bater; senão fica `failed` e visível ao dono.
- Cliente troca de Pix para cartão e de volta: sempre um único pendente, o anterior é encerrado.
- Provedor de cartão desconhecido ou `fake-card` em produção: erro claro na inicialização da cobrança (`provider_unavailable` ao cliente).
- Valor pago diferente do cobrado: `confirmPayment` rejeita, como no Pix.

## 10. Testes

- **Contrato:** a mesma suíte de contrato de provedores da fase 2 ganha uma versão para `CardProvider`, rodada contra o `fake-card` (criar, consultar, cancelar idempotente, webhook assinado, assinatura inválida).
- **Domínio:** `startPayment` com cartão (valor congelado, TTL de 2 minutos, `qr_payload` nulo); trocar de método encerra o pendente e cancela na maquininha; `cancelPayment` (cartão, Pix, venda já aberta, venda paga, provedor fora do ar mantém o pendente, aprovação no mesmo instante vira venda paga); `failPayment` idempotente e sem reverter confirmado; `refreshSale` com intervalo de 2 s para cartão e 10 s para Pix, recusa e expiração voltando a venda para `open` com o motivo.
- **Webhook e rotas:** webhook de cartão (assinatura inválida 401, provedor desconhecido 404, confirmação, recusa, duplicado, fora de ordem); `pay` com `method` válido, ausente e inválido; `payment/cancel`; `paymentFailure` no GET; rotas de desenvolvimento (404 em produção); ids malformados e JSON quebrado nunca dão 500.
- **Isolamento:** pagamento de cartão e cancelamento respeitam RLS; um totem não cancela o pagamento de outro totem nem de outra organização.
- **Manual, no fim do plano:** no navegador com o PDV, fluxo de cartão aprovado e recusado pelas rotas de desenvolvimento, cancelar, tempo esgotado, trocar de Pix para cartão e de volta, e roteiro HTTP autenticado.

## 11. Riscos e premissas

- O contrato foi desenhado para um provedor de cartão em nuvem. Se a maquininha escolhida exigir SDK local, o `CardProvider` ainda serve do lado do servidor, mas o adaptador real precisará da ponte do agente (spec própria, com polling rápido só durante a cobrança). Validar o contrato contra a API real antes de duplicar adaptadores.
- A consulta a cada 2 segundos para cartão aumenta as chamadas ao provedor durante a cobrança; o webhook de recusa e aprovação reduz a espera, e a consulta é só a rede de segurança.
- Sem limite de requisições nas rotas do PDV (follow-up antes de produção, junto com o das fases anteriores).
