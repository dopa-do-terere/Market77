# Market77: fase 2, PDV, venda e Pix

Data: 2026-10-02
Status: aguardando revisão do usuário
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
- `confirmPayment` aceita venda em `awaiting_payment`, `open` ou `expired`. Não aceita `cancelled`, e `cancelled` só é alcançável a partir de `open` sem pagamento pendente. Pagamento confirmado nunca é recusado.
- A confirmação roda em uma transação: `payment` vai a `confirmed`, a venda a `paid` com `paid_at`, e um movimento `sale` negativo por item é inserido com `sale_id`. Saldo negativo é permitido por desenho.
- Valor pago diferente de `amount_cents`: o `payment` vai a `failed` com o payload guardado, a venda não é paga e nenhum movimento é criado.
- `refreshSale(tx, saleId, now)` roda em toda leitura e escrita da venda: `open` vencida vira `expired`; `awaiting_payment` consulta o provedor no máximo a cada 10 s (`payments.checked_at`) e, se o provedor ainda disser pendente e o QR estiver vencido, marca o pagamento `expired` e devolve a venda a `open`. O relógio entra como parâmetro `now`.
- Reconciliação depende de alguém consultar a venda. Uma rota interna `POST /api/internal/reconcile`, chamada por cron, cobre o totem que fechou após pagar; ela é ligada na fase 3, junto com o agente.

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
4. Valor divergente: tratamento da seção 4, resposta 200.

**Teste de contrato:** `paymentProviderContract(factory)` é uma suíte compartilhada que todo adaptador deve passar. Roda hoje no `fake`; o adaptador real entra na mesma suíte contra o sandbox.

## 6. API do totem e tela do PDV

Autenticação do totem: `Authorization: Bearer <token>`. `requireTerminal` aplica SHA-256, busca com `adminSql` entre os totens com `revoked_at` nulo e devolve `{ terminalId, orgId, marketId }`; token inválido ou revogado responde 401. A venda precisa pertencer ao totem chamador, senão 404.

Rotas `/api/pdv/...`, entradas validadas com zod, ids fora do formato UUID respondem 404 (nunca 500), respostas em JSON `{ error, message }` com `message` em português:

| Rota | Efeito |
|---|---|
| `POST /sales/items` `{ saleId?, barcode }` | Cria a venda se não houver; resolve `product_barcodes`; soma 1 ao item. Código desconhecido ou produto inativo no mercado: 404 |
| `PATCH /sales/:id/items/:itemId` `{ quantity }` | Altera a quantidade (1 a 99); 0 remove o item |
| `POST /sales/:id/pay` | `startPayment`; devolve `qrPayload` e `expiresAt` |
| `GET /sales/:id` | `refreshSale`; devolve estado, itens, total e pagamento; consultado a cada 2 s |
| `POST /sales/:id/cancel` | Cancela, só a partir de `open` |

Tela `/pdv`, fora de `/o`, sem login de cliente:
- Primeira abertura: campo para colar o token do totem, guardado em `localStorage`. Sem token válido só essa tela aparece. O risco de um token em `localStorage` numa tela pública é aceito: o token só abre vendas do próprio mercado e é revogável pelo dono.
- Telas: inicial, carrinho (itens, mais e menos, total, "Pagar com Pix"), QR com contagem regressiva e código copia e cola, "Obrigado" (volta à inicial em poucos segundos), "QR expirou" (gera novo QR, carrinho preservado) e "Totem indisponível" (API sem resposta; tenta de novo sozinho; sem venda offline).
- Leitor de código de barras funciona como teclado: um listener na janela acumula as teclas e envia ao receber Enter.
- Manifesto mínimo para ser instalável; sem service worker nem cache offline.
- Texto da interface em português do Brasil.

## 7. Painel do dono

Permissões novas em `src/auth/permissions.ts`:
- `terminal:write`: dono.
- `sale:read`: dono e gerente. O repositor não vê vendas.

Páginas, todas com `requireOrgPage`; actions com `requireOrg(orgId, ação)` antes de qualquer escrita:
- `/o/[orgId]/terminals`: lista (nome, mercado, ativo ou revogado), formulário de cadastro (nome e mercado) e revogação. O token em claro aparece uma vez, na resposta da própria action, com aviso de copiar agora; não vai na URL nem é guardado.
- `/o/[orgId]/sales`: as 50 vendas mais recentes de todos os mercados (data, mercado, total, status, itens). Sem paginação nem filtros.
- `/o/[orgId]/sales/[saleId]`: itens com o preço da época e o pagamento. Pagamento `failed` por valor divergente mostra valor esperado e recebido.
- Dashboard: linha "Vendas hoje: R$ X (N)", calculada por mercado no fuso `markets.timezone`.
- Página do mercado (fase 1): saldo negativo ganha o rótulo "negativo", além de "(baixo)".
- Navegação: "Totens" (dono) e "Vendas" (dono e gerente), coerentes com `can()`.

Mensagens novas em `src/lib/messages.ts` (português): `product_not_found`, `product_inactive`, `sale_not_found`, `sale_not_editable`, `sale_empty`, `sale_too_large`, `terminal_revoked`, `payment_failed`.

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
