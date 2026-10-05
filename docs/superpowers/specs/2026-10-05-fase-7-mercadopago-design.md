# Market77: fase 7, Mercado Pago (Pix e cartão Point) com credenciais por organização

Data: 2026-10-05
Base: `docs/superpowers/specs/2026-10-01-market77-design.md`, fase 2 (Pix, contrato `PaymentProvider`), fase 4 (cartão, contrato `CardProvider`) e as fases 1 a 6, já em `main`.

## 1. Objetivo

Vender com Pix e cartão de verdade no totem, pela conta Mercado Pago de cada dono, sem mudar o fluxo do PDV. Os dois adaptadores reais entram atrás dos contratos existentes. Cada organização liga a própria conta Mercado Pago colando credenciais em uma tela do painel.

Critério de sucesso: com credenciais de teste do Mercado Pago, o roteiro manual completo funciona (Pix pago, cartão aprovado na Point, cartão recusado, cancelamento, expiração), o estoque baixa uma única vez, e a organização A nunca usa nem lê credenciais da B. A suíte automatizada roda sem rede.

Fora desta fase: OAuth, estorno e devolução, parcelamento, impressão de NFC-e na Point, teste automatizado contra a API real (só fixtures gravadas), seleção de provedor diferente de Mercado Pago por organização.

## 2. Decisões

| Tema | Decisão |
|---|---|
| Escopo | Pix e cartão (Point) juntos |
| Credenciais | Por organização, coladas pelo dono (access token e segredo do webhook). Sem OAuth |
| Cartão | Point via Orders API (`POST /v1/orders`, `type: "point"`), nuvem, sem SDK local nem agente |
| Pix | `POST /v1/payments` com `payment_method_id: "pix"` |
| Contratos | `PaymentProvider` e `CardProvider` não mudam |
| Registro | Passa de global por env para resolvido por organização, assíncrono |
| Webhook | URL com `orgId`, porque o segredo de assinatura é por organização |
| Confiança no webhook | O evento só avisa; o estado e o valor vêm de `getCharge` na API |
| Segredos | AES-256-GCM, chave mestra `CREDENTIALS_KEY` no env, nunca devolvidos à tela |
| Maquininha | `terminals.point_device_id` (um totem, uma Point) |

## 3. Credenciais (migration 0009)

`provider_credentials`: `id`, `org_id`, `provider` (`mercadopago`), `access_token_enc`, `webhook_secret_enc`, `token_last4`, `created_at`, `updated_at`. `UNIQUE (org_id, provider)`. RLS por organização, como as demais tabelas.

`terminals` ganha `point_device_id text` (nulo). Validação: de 1 a 64 caracteres, sem NUL nem substituto isolado (mesma regra `storable` da fase 6).

`src/lib/secrets.ts`: `encryptSecret(plain)` e `decryptSecret(blob)`, AES-256-GCM, IV aleatório de 12 bytes, formato `v1:<iv>:<tag>:<dados>` em base64. A chave vem de `CREDENTIALS_KEY` (32 bytes em base64). Chave ausente ou de tamanho errado: erro claro ao salvar ou ler credenciais; o restante do sistema sobe normalmente. Texto cifrado adulterado falha na leitura.

Os segredos nunca voltam para a tela. A tela mostra "configurado em <data>" e `token_last4`. Trocar é colar de novo.

## 4. Registro por organização

`src/payments/registry.ts`:
- `getPixProvider(tx, orgId)` e `getCardProvider(tx, orgId)` leem `provider_credentials` da organização. Com credenciais, devolvem o adaptador Mercado Pago montado com elas. Sem credenciais: `fake` fora de produção; em produção, `provider_unavailable`.
- O registro de nomes continua com `Object.hasOwn` para rotas antigas `/api/webhooks/{pix|card}/[provider]`, que passam a aceitar só `fake`.
- Cache por organização em `Map` em memória, invalidado quando o dono salva ou remove credenciais (`// ponytail`: por processo; com várias instâncias, a troca vale em até o TTL de 60 s do cache).
- `PIX_PROVIDER` e `CARD_PROVIDER` saem do env, de `vitest.config.ts` e do README.

Pontos de chamada que passam a receber `orgId`: `payments/reconcile.ts`, `payments/webhook.ts`, `domain/refresh.ts`, `pdv/http.ts` (2), `domain/payments.ts` (2).

Os adaptadores recebem as credenciais e um `fetch` no construtor (`fetch` injetável para teste).

## 5. Adaptadores (`src/payments/mercadopago.ts`)

Toda chamada usa `withTimeout`. O corpo de erro do Mercado Pago nunca vai para o cliente nem para o log (pode conter dados do pagador); só código HTTP e um texto fixo.

**Pix** (`createPixCharge`, `getCharge`, `parseWebhook`):
- `POST https://api.mercadopago.com/v1/payments`, cabeçalhos `Authorization: Bearer`, `X-Idempotency-Key` (`saleId` mais a expiração) e `Content-Type`.
- Corpo: `transaction_amount` em reais (centavos dividido por 100, duas casas), `payment_method_id: "pix"`, `date_of_expiration` igual a `expiresAt`, `external_reference` igual a `saleId`, `payer.email` genérico da organização (o totem não coleta dados do cliente).
- Resposta: `id` vira `externalId`; `point_of_interaction.transaction_data.qr_code` vira `qrPayload`.
- `getCharge`: `GET /v1/payments/{id}`. `approved` vira `confirmed`; `pending` e `in_process` viram `pending`; `cancelled` e `rejected` viram `failed`; `expired` vira `expired`. O valor volta em centavos.

**Cartão** (`createCardCharge`, `cancelCardCharge`, `getCharge`, `parseWebhook`):
- `POST /v1/orders` com `type: "point"`, `external_reference` igual a `saleId`, `expiration_time` em ISO-8601 (`PT2M`), `transactions.payments[0].amount` como string em reais, `config.point.terminal_id` igual a `terminals.point_device_id`, `config.point.print_on_terminal: "no_ticket"`. Sem `default_type`: débito ou crédito é escolhido na máquina.
- `cancelCardCharge`: `POST /v1/orders/{id}/cancel`, idempotente (ordem já cancelada ou já processada não é erro).
- `getCharge`: `GET /v1/orders/{id}`. `processed` vira `confirmed`; `canceled` vira `failed` com `cancelled`; `failed` vira `failed` com `declined`; `expired` vira `expired`; `created`, `at_terminal` e `action_required` viram `pending`.
- Totem sem `point_device_id`: `createCardCharge` responde `provider_unavailable` e a tela do totem oferece só Pix.

Os mapeamentos de estado e os campos exatos são conferidos contra a referência oficial no plano, com fixtures gravadas de respostas reais da conta de teste.

## 6. Webhook por organização

Rotas novas: `POST /api/webhooks/pix/mercadopago/[orgId]` e `POST /api/webhooks/card/mercadopago/[orgId]`. As rotas `/[provider]` existentes seguem só para o `fake`.

Fluxo:
1. Lê o corpo cru e valida o `orgId` como uuid (inválido: 404).
2. Carrega o segredo da organização com `adminSql` (só para descobrir o segredo e a existência das credenciais). Organização inexistente ou sem credenciais: 404 `unknown_provider`.
3. Valida `x-signature`: HMAC-SHA256 do manifesto formado por `data.id`, `x-request-id` e `ts`, comparado com `timingSafeEqual`. `ts` com mais de 5 minutos de diferença é rejeitado. Inválida: 401 `invalid_webhook`. O formato exato do manifesto é conferido no plano contra a documentação.
4. Eventos de outros tipos: 200 `ignored`.
5. Para um evento de pagamento ou de ordem, localiza o `payment` pelo `external_id` (dentro da organização, em `withOrg`), chama `getCharge` e usa o estado e o valor devolvidos pela API, não os do corpo do webhook. Em seguida aplica `confirmPayment` ou `failPayment`, os mesmos da fase 4, idempotentes.
6. Pagamento desconhecido: 200 `unknown_payment`. Responde em menos de 22 s.

## 7. Tela do dono

`/o/[orgId]/settings/payments`, só dono:
- Formulário com access token e segredo do webhook. Mostra a URL de webhook da organização para copiar (Pix e cartão), e o status "configurado em <data>, token terminando em XXXX".
- Botão **Testar**: `GET https://api.mercadopago.com/users/me` com o token salvo; mostra se vale.
- Salvar, trocar e remover são actions de dono. Remover apaga a linha e invalida o cache.
- O cadastro de totem (`/o/[orgId]/terminals`) ganha o campo **ID da maquininha Point**, editável pelo dono.

## 8. Erros

- Sem credenciais em produção, token inválido (401 do Mercado Pago), timeout ou 5xx viram `provider_unavailable`; a venda continua consistente e um pagamento já aprovado nunca é desfeito.
- Cancelamento de cartão que falha mantém o pagamento pendente, como na fase 4.
- `CREDENTIALS_KEY` ausente: salvar credenciais responde erro claro ao dono; pagar com Mercado Pago em uma organização já configurada responde `provider_unavailable`.

## 9. Testes

- **Contrato:** a suíte de contrato de `PaymentProvider` e de `CardProvider` roda também contra os adaptadores Mercado Pago, com `fetch` injetado devolvendo fixtures gravadas (criar, consultar, cancelar idempotente, mapeamento de todos os estados, assinatura válida, inválida e `ts` velho).
- **Segredos:** ida e volta, texto adulterado falha, chave ausente ou de tamanho errado falha com erro claro.
- **Registro:** com credenciais usa Mercado Pago, sem credenciais usa `fake` fora de produção e falha em produção, isolamento entre organizações (a organização A nunca lê o segredo da B), invalidação do cache ao salvar.
- **Webhook:** organização inexistente, assinatura inválida, evento duplicado, evento para pagamento de outra organização, estado vindo da API e não do corpo.
- **Tela e totem:** só dono salva credenciais; o segredo nunca aparece em resposta nem em HTML; totem sem `point_device_id` não oferece cartão.
- **Manual:** roteiro com conta de teste do Mercado Pago e uma Point: Pix pago, cartão aprovado, recusado, cancelado pelo totem, expirado.

## 10. Fases seguintes

- OAuth para conectar a conta Mercado Pago sem colar token.
- Estorno e devolução, parcelamento.
- Impressão do comprovante ou da NFC-e na Point, depois do provedor fiscal real.
- Provedor fiscal real (ver fase 5B+).
