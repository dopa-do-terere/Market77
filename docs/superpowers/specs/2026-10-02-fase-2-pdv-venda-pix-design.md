# Market77: fase 2, PDV, venda e Pix

Data: 2026-10-02
Status: aprovado em 2026-10-02 e implementado. Atualizado após a revisão final para refletir o comportamento real (seção 11 lista os desvios do texto original)
Base: `docs/superpowers/specs/2026-10-01-market77-design.md` (seções 2, 4, 5, 6 e 8). Este documento detalha a fase 2 e, onde diverge, prevalece sobre ele (seção 9).

## 1. Objetivo

Um cliente anônimo escaneia produtos em um totem, paga por Pix, o estoque baixa sozinho na confirmação e o dono acompanha a venda no painel.

Critério de sucesso: com o adaptador simulado de Pix, o fluxo completo funciona de ponta a ponta no navegador (escanear, carrinho, QR, pagamento simulado, agradecimento), o estoque baixa uma única vez mesmo com webhooks duplicados ou simultâneos, e o dono vê a venda no painel. O primeiro provedor Pix real entra depois, como adaptador, sem mudar o restante.

Fora desta fase: cartão e maquininha (fase 4), NFC-e (fase 5), lote, validade e FEFO (fase 5), agente do totem, heartbeat e comandos remotos (fase 3), devolução e estorno, relatórios, venda offline, login de cliente, intermediação de pagamento.

## 2. Decisões tomadas

| Tema | Decisão |
|---|---|
| Provedor Pix | Interface `PaymentProvider` mais adaptador simulado (`fake`). Provedor real fica para depois |
| Identidade do totem | Tabela `terminals` mínima com token do dispositivo (hash no banco). Heartbeat e comandos entram na fase 3 sobre a mesma tabela |
| Estoque zero no PDV | Vende e sinaliza ao dono. O saldo fica negativo e visível no painel |
| Confirmação do pagamento | Webhook mais reconciliação preguiçosa, no monólito Next. Sem worker nem fila |
| Custo no item | `unit_cost_cents` fica nulo; só os lotes (fase 5) terão custo. Não se inventa custo |
| Credenciais do provedor | Sem `provider_credentials` nesta fase. A tabela chega com o primeiro adaptador real |
| Baixa de estoque | Movimento `sale` simples por item, sem FEFO (não existem lotes ainda) |
| Dependência nova | `qrcode`, para desenhar o QR do código Pix |

Divergência do spec geral, seção 6: onde ele diz "Pix expirou: venda expira", entende-se que o pagamento expira e o carrinho continua ("carrinho preservado, cliente gera novo QR"). O estado `expired` da venda fica reservado ao carrinho abandonado.

## 3. Modelo de dados

Migration `0002`. Todas as tabelas com `org_id`, RLS pela mesma política da fase 1 (`nullif(current_setting('app.org_id', true), '')::uuid`, `USING` e `WITH CHECK`), FKs compostas `(id, org_id)` e `GRANT` mínimo ao papel `market77_app`.

**`terminals`**: `id`, `org_id`, `market_id`, `name`, `token_hash` (único), `created_at`, `revoked_at`. O token em claro (32 bytes aleatórios, base64url) aparece uma vez no cadastro. Só o SHA-256 é guardado.

**`sales`**: `id`, `org_id`, `market_id`, `terminal_id`, `status` (`open`, `awaiting_payment`, `paid`, `cancelled`, `expired`), `total_cents`, `expires_at`, `paid_at`, `created_at`.

**`sale_items`**: `id`, `org_id`, `sale_id`, `market_product_id`, `product_name`, `quantity`, `unit_price_cents`, `unit_cost_cents` (nulo nesta fase). `UNIQUE (sale_id, market_product_id)`. Preço e nome copiados no momento da adição.

**`payments`**: `id`, `org_id`, `sale_id`, `method` (`pix`), `provider`, `external_id`, `status` (`pending`, `confirmed`, `expired`, `failed`), `amount_cents`, `qr_payload`, `expires_at`, `checked_at`, `webhook_payload` (jsonb), `created_at`. `UNIQUE (provider, external_id)` e índice único parcial em `(sale_id)` onde `status = 'pending'`.

**`stock_movements`** ganha `sale_id` opcional (FK composta). Índice único parcial em `(sale_id, market_product_id)` onde `type = 'sale'`: uma venda não baixa o mesmo produto duas vezes, mesmo que a confirmação rode em duplicidade.

Permissões do papel da aplicação: `SELECT, INSERT, UPDATE` em `terminals`, `sales` e `payments`; `SELECT, INSERT, UPDATE, DELETE` em `sale_items` (remoção de item); `stock_movements` continua só `SELECT, INSERT`.

Duas consultas acontecem sem `orgId` e por isso usam `adminSql`, como a autenticação: o token do totem (`terminals.token_hash`) e o pagamento do webhook (`payments.provider, external_id`). Nos dois casos o `adminSql` só descobre a organização; todo o restante roda em `withOrg`.

## 4. Máquina de estados da venda

```
open --startPayment--> awaiting_payment --confirm--> paid   (final)
  |                         |
  |                         +-- QR expira --> open (carrinho preservado, pagamento vira expired)
  +-- inatividade --> expired   (carrinho abandonado)
  +-- cancelar -----> cancelled (só a partir de open)
```

Regras:

- Itens só se editam em `open`. Cada alteração renova `expires_at` (inatividade, 5 minutos).
- Quantidade por item: de 1 a 99. Total da venda limitado a R$ 10.000,00 (1.000.000 de centavos); acima disso `sale_too_large`. Evita overflow de `integer` em `total_cents`.
- `startPayment` exige venda com itens, calcula e congela `total_cents`, cria a cobrança no provedor e a venda vai a `awaiting_payment`. Se já existe pagamento pendente com QR válido, devolve o mesmo QR.
- Validade do QR: 3 minutos.
- `confirmPayment` aceita venda em `awaiting_payment`, `open` ou `expired` (pagamento tardio) e nunca o recusa por falta de estoque. Ele recusa, guardando o pagamento como `failed` com o payload (visível ao dono), quatro casos: valor pago diferente do cobrado; venda `cancelled`; venda já `paid` por outro pagamento; valor do pagamento diferente do `total_cents` atual da venda (carrinho editado depois de o QR vencer). Ou seja, um pagamento tardio só confirma se o total congelado não mudou; a comparação é apenas do total, não dos itens. Um pagamento `failed` pode virar `confirmed` se chegar de novo com o valor certo e as condições valerem. `cancelled` só é alcançável a partir de `open`.
- A confirmação roda em uma transação: `payment` vai a `confirmed`, os demais pagamentos `pending` da mesma venda vão a `expired`, a venda vai a `paid` com `paid_at`, e um movimento `sale` negativo por item é inserido com `sale_id`. Saldo negativo é permitido por desenho. `webhook_payload` guarda `{ paidAmountCents, event }` como objeto jsonb.
- Ordem de travas em todo o código: linha da venda primeiro, depois as linhas de pagamento. Nenhum caminho trava pagamento antes da venda.
- `refreshSale(tx, term, saleId, provider, now)` roda em toda leitura da venda: `open` vencida vira `expired`; `awaiting_payment` sem pagamento pendente volta a `open`; com pagamento pendente consulta o provedor no máximo a cada 10 s (`payments.checked_at`): `confirmed` confirma o pagamento; `failed` marca o pagamento `failed` e reabre a venda; `expired`, ou QR vencido sem resposta do provedor, marca o pagamento `expired` e reabre a venda com a janela do carrinho renovada. Se a confirmação feita dentro do refresh for recusada, a venda é reaberta na hora. O relógio entra como parâmetro `now`.
- Chamadas ao provedor (`createPixCharge`, `getCharge`) têm timeout de 5 s. No início do pagamento o timeout vira `provider_unavailable` (503); na reconciliação conta como "sem resposta" e a venda não trava.
- Reconciliação por cron: `POST /api/internal/reconcile` fica desligada (404) sem `RECONCILE_SECRET`, exige o cabeçalho `x-reconcile-secret`, visita até 100 vendas `awaiting_payment` das mais antigas e responde `{ visited }`. O agendamento fica para a fase 3.

## 5. Camada de pagamento

`src/payments/provider.ts`:

```ts
interface PaymentProvider {
  name: string;
  createPixCharge(i: { saleId: string; amountCents: number; expiresAt: Date }):
    Promise<{ externalId: string; qrPayload: string; expiresAt: Date }>;
  getCharge(externalId: string):
    Promise<{ status: "pending" | "confirmed" | "expired" | "failed"; amountCents: number }>;
  parseWebhook(headers: Headers, rawBody: string):
    { externalId: string; status: "confirmed" | "expired" | "failed"; amountCents: number } | null;
}
```

`parseWebhook` valida a assinatura e lança erro se for inválida. `null` significa evento irrelevante.

**Adaptador `fake`** (`src/payments/fake.ts`):
- Gera QR falso; estado das cobranças em memória (só dev e teste).
- Recusa funcionar com `NODE_ENV=production`.
- O pagamento simulado entra pelo mesmo webhook real, assinado com HMAC-SHA256 e o segredo `FAKE_PIX_SECRET` do `.env`, comparado com `timingSafeEqual`. A rota de dev `POST /api/dev/fake-pix/:externalId/pay` (também desativada em produção) dispara esse webhook, de modo que o caminho de produção é exercitado.

**Seleção:** variável `PIX_PROVIDER=fake`, global. Passa a ser por organização, via `provider_credentials`, com o primeiro adaptador real.

**Webhook** `POST /api/webhooks/pix/[provider]`, lendo o corpo cru:
1. `parseWebhook`; assinatura inválida responde 401.
2. Localiza o pagamento por `(provider, external_id)` com `adminSql`; desconhecido responde 200 e é ignorado.
3. `confirmPayment` em `withOrg`; pagamento já confirmado é no-op com 200.
4. Recusa (valor divergente, venda cancelada ou já paga, total alterado): tratamento da seção 4, resultado `rejected`, resposta 200.

Outros resultados: provedor desconhecido na URL responde 404 (`unknown_provider`); corpo inválido, mesmo com assinatura válida, responde 401 (`invalid_webhook`); eventos `expired` e `failed` respondem 200 `ignored` (a reconciliação lê o mesmo estado no provedor).

**Teste de contrato:** `paymentProviderContract(factory)` é uma suíte compartilhada que todo adaptador deve passar. Roda hoje no `fake`; o adaptador real entra na mesma suíte contra o sandbox.

## 6. API do totem e tela do PDV

Autenticação do totem: `Authorization: Bearer <token>`. `requireTerminal` aplica SHA-256, busca o totem com `adminSql` e devolve `{ terminalId, orgId, marketId }`. Token ausente ou desconhecido responde 401 `unauthorized`; token de um totem revogado responde 401 `terminal_revoked` (só vale para um token que existe), e o PDV mostra então a tela "Totem desativado". A venda precisa pertencer ao totem chamador, senão 404.

Rotas `/api/pdv/...`, entradas validadas com zod, ids fora do formato UUID respondem 404 (nunca 500), JSON quebrado responde 400, `saleId` vazio responde `invalid_input`, respostas em JSON `{ error, message }` com `message` em português. A tabela de status é: `invalid_input` 400; `unauthorized` e `terminal_revoked` 401; `forbidden` 403; `not_found`, `sale_not_found`, `product_not_found` e `product_inactive` 404; `sale_not_editable` 409; `sale_empty`, `sale_too_large` e `quantity_limit` 422 (o 100º escaneamento do mesmo produto dá `quantity_limit`); `provider_unavailable` 503; erro inesperado 500 genérico. Além das rotas abaixo existe `GET /ping` (valida o token e detecta a volta da rede):

| Rota | Efeito |
|---|---|
| `POST /sales/items` `{ saleId?, barcode }` | Cria a venda se não houver; resolve `product_barcodes`; soma 1 ao item. Código desconhecido ou produto inativo no mercado: 404 |
| `PATCH /sales/:id/items/:itemId` `{ quantity }` | Altera a quantidade (1 a 99); 0 remove o item |
| `POST /sales/:id/pay` | `startPayment`; devolve `qrPayload` e `expiresAt` |
| `GET /sales/:id` | `refreshSale`; devolve estado, itens, total e pagamento; consultado a cada 2 s |
| `POST /sales/:id/cancel` | Cancela, só a partir de `open` |

Tela `/pdv`, fora de `/o`, sem login de cliente:
- Primeira abertura: campo para colar o token do totem, guardado em `localStorage`. Sem token válido só essa tela aparece. O risco de um token em `localStorage` numa tela pública é aceito: o token só abre vendas do próprio mercado e é revogável pelo dono.
- Telas: inicial, carrinho (itens, mais e menos, total, "Pagar com Pix"), QR com contagem regressiva e código copia e cola, "Obrigado" (volta à inicial depois de 6 segundos), "QR expirou" (é o próprio carrinho com um aviso; gera novo QR, carrinho preservado), "Totem indisponível" (API sem resposta, inclusive por timeout de 10 s do `fetch`; tenta de novo sozinho; sem venda offline) e "Totem desativado" (token revogado).
- Se o servidor responde `sale_not_found` ou `sale_not_editable` a um escaneamento com a venda local aberta, o PDV abre uma venda nova. Escaneamentos são serializados e ignorados enquanto se paga.
- Leitor de código de barras funciona como teclado: um listener na janela acumula as teclas e envia ao receber Enter; o Enter é capturado (`preventDefault`) para não acionar o botão com foco.
- Manifesto mínimo para ser instalável; sem service worker nem cache offline.
- Texto da interface em português do Brasil.

## 7. Painel do dono

Permissões novas em `src/auth/permissions.ts`:
- `terminal:write`: dono.
- `sale:read`: dono e gerente. O repositor não vê vendas.

Páginas, todas com `requireOrgPage`; actions com `requireOrg(orgId, ação)` antes de qualquer escrita:
- `/o/[orgId]/terminals`: lista (nome, mercado, ativo ou revogado), formulário de cadastro (nome e mercado) e revogação. O token em claro aparece uma vez, na resposta da própria action, com aviso de copiar agora; não vai na URL nem é guardado.
- `/o/[orgId]/sales`: as 50 vendas mais recentes de todos os mercados que tenham itens ou algum pagamento (data, mercado, total, status, itens), com "(requer atenção)" nas que têm pagamento `failed`. Sem paginação nem filtros.
- `/o/[orgId]/sales/[saleId]`: itens com o preço da época e o pagamento. Pagamento `failed` por valor divergente mostra valor esperado e recebido.
- Dashboard: linha "Vendas hoje: R$ X (N)", calculada por mercado no fuso `markets.timezone`.
- Página do mercado (fase 1): saldo negativo ganha o rótulo "negativo", além de "(baixo)".
- Navegação: "Totens" (dono) e "Vendas" (dono e gerente), coerentes com `can()`.

Mensagens novas em `src/lib/messages.ts` (português): `unauthorized`, `terminal_revoked`, `product_not_found`, `product_inactive`, `sale_not_found`, `sale_not_editable`, `sale_empty`, `sale_too_large`, `quantity_limit`, `provider_unavailable`, `payment_failed` (esta ainda sem uso).

## 8. Organização do código

- `src/payments/provider.ts`, `fake.ts`, `registry.ts`: interface, adaptador simulado e escolha por `PIX_PROVIDER`.
- `src/domain/terminals.ts`, `sales.ts`, `payments.ts`: regras de domínio; recebem `Tx`, como na fase 1. A autorização fica na camada de actions e rotas.
- `src/pdv/auth.ts`: `requireTerminal`.
- `src/app/api/pdv/...`, `src/app/api/webhooks/pix/[provider]/route.ts`, `src/app/api/dev/fake-pix/...`, `src/app/api/internal/reconcile/route.ts` (esqueleto protegido por segredo, ligado na fase 3).
- `src/app/pdv/...`: a tela do totem.
- Painel: páginas da seção 7 em `src/app/o/[orgId]/`.

## 9. Testes

Vitest contra o Postgres real, como na fase 1; as tabelas novas entram no `resetDb`. Handlers de rota são testados chamando-os com objetos `Request`.

- **Máquina de estados:** transições válidas e inválidas; `refreshSale` com `now` injetado (carrinho abandonado vira `expired`, QR vencido volta a `open` com o carrinho intacto); `startPayment` repetido devolve o mesmo QR; preço congelado ao mudar `market_products` depois; teto de total e de quantidade.
- **`confirmPayment`:** movimentos negativos por item com `sale_id`; aceita `awaiting_payment`, `open` e `expired` e rejeita `cancelled`; saldo negativo permitido; valor divergente gera `failed` sem movimentos; 20 confirmações simultâneas do mesmo pagamento resultam em um único conjunto de movimentos e saldo exato.
- **Webhook e reconciliação:** assinatura inválida 401; pagamento desconhecido ignorado com 200; duplicado confirma uma vez; reconciliação preguiçosa nos dois sentidos (confirmado, e pendente com QR vencido).
- **Contrato:** `paymentProviderContract` no `fake`.
- **Isolamento e autorização:** RLS nas tabelas novas (o tenant A não lê vendas, totens nem pagamentos do B); FK composta barra referência cruzada em `sale_items`; token da org A não toca venda da org B; totem não toca venda de outro totem; token revogado 401; repositor sem `sale:read`; gerente sem `terminal:write`; páginas respondem 404 e nunca erro não tratado.
- **Entradas ruins:** ids fora do formato UUID, quantidade 0, 100, negativa ou fracionada, código desconhecido e produto inativo respondem 4xx, nunca 500.
- **Manual, no fim do plano** (o implementador não tem navegador): fluxo completo no PDV com leitor de código de barras real ou teclado, pagamento pela rota de dev do `fake`, QR expirando, tela de "indisponível" ao derrubar o servidor, e roteiro HTTP autenticado por papel.

## 10. Riscos e pendências

- Provedor Pix real e sua conta de sandbox continuam por escolher; definem o esforço do primeiro adaptador e a ligação com `provider_credentials`.
- Sem cron, a reconciliação só acontece enquanto o totem consulta a venda; a rota interna entra em operação na fase 3.
- As rotas do PDV não têm limite de requisições; follow-up antes de produção, junto com o do login.
- FEFO e custo ficam para a fase 5: a baixa de estoque desta fase é por saldo, e `unit_cost_cents` fica nulo.
- Pendências herdadas da fase 1, antes de produção: senha do papel `market77_app` fora da migration, parâmetros do scrypt, limite de tentativas de login e convite com aceite na equipe.
