# Market77: fase 5B, NFC-e (provedor fiscal simulado)

Data: 2026-10-03
Status: aguardando revisão do usuário
Base: `docs/superpowers/specs/2026-10-01-market77-design.md` (seções 3, 5, 6 e 8) e as fases 1 a 5A, já em `main`.

## 1. Objetivo

Toda venda paga de um mercado com NFC-e ligada gera um documento fiscal que é emitido em segundo plano, com retry quando o provedor falha, e cujo estado (emitida, pendente ou com erro) o dono vê no painel. O cliente pode informar o CPF antes de pagar. A venda nunca deixa de estar paga por causa da nota. O provedor fiscal real ainda não foi escolhido, então esta fase entrega o fluxo completo (dados fiscais, fila, retry, totem e painel) sobre um **provedor simulado**; o real entra depois atrás da mesma interface, como foi feito com o Pix e o cartão.

Fora desta fase: cancelamento de nota, contingência offline, regime normal (Lucro Presumido ou Real), gestão de CSC e credenciais do provedor por organização, envio da nota por e-mail ou SMS, provedor fiscal real.

## 2. Decisões

| Tema | Decisão |
|---|---|
| Integração | Provedor fiscal em nuvem atrás da interface `FiscalProvider`. Nesta fase só o adaptador `fake-fiscal` |
| Disparo | Fila no banco: `confirmPayment` grava o documento `pending` na mesma transação; a rota `POST /api/internal/reconcile` (já chamada a cada minuto) processa a fila |
| Regime | O mercado guarda `tax_regime`. Só `simples` emite; `normal` é aceito no cadastro e o documento vai para `error` com `unsupported_regime` |
| CPF | Opcional, perguntado no carrinho antes de pagar. Sem CPF, "consumidor não identificado" |
| Falha | A venda segue paga. Provedor fora do ar: retry. Dados inválidos: `error` na hora. O dono corrige e aperta **Reemitir** |
| Duplicidade | A referência do provedor é o id do documento; o retry consulta `getByRef` antes de emitir de novo |
| Ligar/desligar | Mercado sem `nfce_enabled` não cria documento nenhum; nada muda para ele |

## 3. Modelo de dados (migration `0007_nfce.sql`)

**`markets`**: `nfce_enabled boolean not null default false`, `state_registration text`, `uf text` (duas letras maiúsculas, `CHECK (uf ~ '^[A-Z]{2}$')`), `tax_regime text not null default 'simples' CHECK (tax_regime IN ('simples', 'normal'))`, `nfce_series integer not null default 1 CHECK (nfce_series BETWEEN 1 AND 999)`.

**`products`**: `ncm text CHECK (ncm ~ '^[0-9]{8}$')`, `cest text CHECK (cest ~ '^[0-9]{7}$')`, `cfop text not null default '5102' CHECK (cfop ~ '^[0-9]{4}$')`, `csosn text not null default '102' CHECK (csosn ~ '^[0-9]{3}$')`, `unit text not null default 'UN' CHECK (char_length(unit) BETWEEN 1 AND 6)`, `origin smallint not null default 0 CHECK (origin BETWEEN 0 AND 8)`. `ncm` e `cest` ficam nulos nos produtos antigos.

**`sales`**: `customer_cpf text CHECK (customer_cpf ~ '^[0-9]{11}$')`.

**`fiscal_documents`** (nova, uma por venda): `id`, `org_id`, `sale_id` (único, chave composta `(sale_id, org_id)` para `sales`), `market_id`, `status` (`pending`, `issued`, `error`), `attempts integer not null default 0`, `next_attempt_at timestamptz not null default now()`, `last_error text`, `payload jsonb not null`, `provider text`, `external_id text`, `number integer`, `access_key text`, `danfe_url text`, `issued_at timestamptz`, `created_at`, `updated_at`. Índice parcial em `(next_attempt_at) WHERE status = 'pending'`. Único `(provider, external_id) WHERE external_id IS NOT NULL`. RLS no padrão das outras tabelas; `GRANT SELECT, INSERT, UPDATE` ao papel `market77_app` (sem `DELETE`).

**Foto dos dados (`payload`)**, gravada na venda e refeita só na reemissão:

```json
{
  "emitter": { "cnpj": "...", "stateRegistration": "...", "uf": "SP", "series": 1, "regime": "simples" },
  "customer": { "cpf": "12345678909" },
  "items": [{ "description": "...", "ncm": "22021000", "cest": null, "cfop": "5102", "csosn": "102",
              "unit": "UN", "origin": 0, "quantity": 2, "unitPriceCents": 590, "totalCents": 1180 }],
  "totalCents": 1180,
  "paymentMethod": "pix",
  "paidAt": "2026-10-03T15:00:00.000Z"
}
```

`customer` é `null` sem CPF. Campos fiscais ausentes ficam `null` na foto e são recusados na validação, não na gravação.

## 4. Provedor fiscal (`src/fiscal/`)

- **`provider.ts`**: `interface FiscalProvider { name: string; issueNfce(ref: string, payload: FiscalPayload): Promise<FiscalIssued>; getByRef(ref: string): Promise<FiscalIssued | null> }`, com `FiscalIssued = { externalId, number, accessKey, danfeUrl }`. Erros tipados `FiscalRejected(code, message)` (dados inválidos, sem retry) e `FiscalUnavailable` (fora do ar ou lento, com retry). Chamadas com `withTimeout` de 5 s, como nos outros provedores.
- **`fake-fiscal.ts`**: numera em sequência, guarda as emissões por `ref` em memória (`globalThis`, para sobreviver ao HMR) e é idempotente: a mesma `ref` devolve a mesma nota. Gera `accessKey` de 44 dígitos determinística e `danfeUrl` fictícia. Recusa `NODE_ENV=production`. Modos de teste: `ok`, `down` (lança `FiscalUnavailable`), `reject` (lança `FiscalRejected("fake_rejected", ...)`), e `lost` (emite mas lança `FiscalUnavailable`, simulando resposta perdida). O modo é trocado por `POST /api/dev/fake-fiscal/mode` com `{ "mode": "..." }`, rota que também recusa produção.
- **`registry.ts`**: `getFiscalProvider()` lê `FISCAL_PROVIDER` (`fake`); desconhecido lança `AppError("provider_unavailable")`, como o cartão.
- **Suíte de contrato** em `tests/fiscal/fiscal-contract.ts`, para qualquer adaptador passar: idempotência por `ref`, `getByRef` de ref desconhecida devolve `null`, erros tipados.

## 5. Domínio (`src/domain/fiscal.ts`)

- **`validateCpf(s)` e `validateCnpj(s)`** (`src/lib/tax-id.ts`): dígitos verificadores; recusam sequências repetidas.
- **`buildPayload(tx, saleId)`**: lê mercado, itens (com os campos fiscais do produto no momento) e CPF e monta a foto.
- **`enqueueFiscalDocument(tx, saleId, now)`**: chamado em `confirmPayment` depois de marcar a venda paga e baixar o estoque. Não faz nada se o mercado não tem `nfce_enabled`. Faz `insert ... on conflict (sale_id) do nothing`. Qualquer exceção dentro dele é capturada e registrada; o pagamento nunca falha por causa dele.
- **`validatePayload(payload)`**: devolve o primeiro erro ou `null`. Códigos: `unsupported_regime`, `invalid_cnpj`, `missing_state_registration`, `missing_uf`, `invalid_customer_cpf`, `missing_ncm` (com o nome do produto na mensagem), `empty_sale`.
- **`processFiscalQueue(now, limit = 50)`**: seleciona (com `adminSql`, só para descobrir organização e id) os documentos `pending` com `next_attempt_at <= now`. Para cada um, em `withOrg`: trava a linha (`for update skip locked`); valida; se inválido, `error` sem retry; senão chama `getByRef(id)` (se achar, grava como `issued` sem emitir de novo) ou `issueNfce(id, payload)`. Sucesso grava `issued`, `number`, `access_key`, `danfe_url`, `provider`, `external_id`, `issued_at`. `FiscalRejected` grava `error` com `code: message`. `FiscalUnavailable` incrementa `attempts` e agenda `next_attempt_at = now + min(2^(attempts-1), 60)` minutos; na 8ª falha vira `error` com `unavailable`. Um erro num documento não interrompe os outros. Devolve quantos foram processados.
- **`reissueFiscalDocument(tx, saleId, now)`**: só para `status = 'error'` (senão `invalid_input`); refaz a foto, zera `attempts` e `last_error`, volta a `pending` com `next_attempt_at = now`.
- **`setCustomerCpf(tx, term, saleId, raw, now)`**: trava a venda (`lockSale`); só em `open` (senão `sale_not_editable`); `cpf` nulo limpa; CPF inválido dá `invalid_cpf` (400).
- **`updateMarketFiscal(tx, marketId, raw)`** e **`updateProductFiscal(tx, productId, raw)`**: validam com `zod` e gravam os campos fiscais (o CNPJ do mercado passa a validar dígitos). Id inexistente ou de outra organização dá `not_found`.
- **Leituras**: `SaleView.customerCpfMasked` (`***.456.789-**`) para o totem; `getSaleDetail` devolve a nota (`status`, `number`, `accessKey`, `danfeUrl`, `lastError`) e o CPF mascarado; `listRecentSales` marca `fiscalError`; `countFiscalErrors(tx)` para a página inicial.

A rota `POST /api/internal/reconcile` passa a devolver `{ visited, fiscal }`, rodando `reconcilePending()` e `processFiscalQueue()`; um erro de uma fila não impede a outra.

## 6. Totem

`PUT /api/pdv/sales/:id/customer` com `{ "cpf": "<11 dígitos>" | null }`; mesma autenticação do PDV (token do totem), ids malformados e vendas de outro totem dão 404. No carrinho entra o botão **CPF na nota**, que abre um teclado numérico com **Confirmar**, **Limpar** e **Sem CPF**; o CPF informado aparece mascarado ("CPF na nota: ***.456.789-**"). O botão some quando a venda não está mais em `open`. O fluxo de pagamento não muda.

## 7. Painel do dono

- **Mercado** (`markets/[marketId]`): formulário "Dados fiscais" (ligar NFC-e, CNPJ, inscrição estadual, UF, regime, série), visível com `market:write`.
- **Produtos** (`products`): em cada produto, um bloco "Dados fiscais" (NCM, CEST, CFOP, CSOSN, unidade, origem), visível com `product:write`.
- **Detalhe da venda**: seção "Nota fiscal" com a situação ("Emitida", "Pendente", "Com erro"), número, chave, link do DANFE e a última falha em português; botão **Reemitir** com `market:write` quando está em `error`. O CPF aparece mascarado.
- **Lista de vendas e página inicial**: selo "nota com erro" na lista; a página inicial mostra a contagem de notas com erro, com link para a lista.

## 8. Erros e bordas

- Mercado com NFC-e ligada mas sem inscrição estadual, UF ou CNPJ válido: o documento é criado e vai a `error` com a causa; o dono completa o cadastro e reemite.
- Produto sem NCM: `error` com `missing_ncm` e o nome do produto.
- Pagamento confirmado duas vezes ou webhook repetido: um único documento (`on conflict`).
- Resposta perdida do provedor: o retry acha a nota por `getByRef` e não emite duas.
- Dois processadores ao mesmo tempo: `skip locked` impede emissão dupla; o segundo passa para o próximo documento.
- Mudança de cadastro depois da venda: não altera a nota pendente (a foto é da hora da venda); só a reemissão a refaz.
- CPF informado e depois a venda é cancelada ou expira: nada é emitido (só vendas pagas geram documento).
- Entradas ruins no totem e no painel nunca dão 500: JSON quebrado, CPF inválido e id malformado viram 400 ou 404.

## 9. Testes

- Documentos de identificação: CPF e CNPJ válidos, inválidos, repetidos e com máscara.
- Contrato do adaptador fiscal e do `fake-fiscal` (idempotência, modos, produção recusada).
- Schema: constraints dos campos novos, unicidade por venda, RLS e grants de `fiscal_documents`.
- `enqueue`: mercado ligado e desligado; foto congelada; chamado duas vezes gera um só; falha interna não derruba `confirmPayment`.
- Processador: sucesso; retry com espera crescente (1, 2, 4... até 60 min); 8ª falha vira `error`; rejeição imediata; regime normal; produto sem NCM; resposta perdida sem duplicar; dois processadores concorrentes; um documento ruim não para a fila.
- Reemissão: só em `error`; refaz a foto com o cadastro novo.
- CPF no PDV: válido, inválido, nulo, venda fora do carrinho, outro totem; contrato JSON do `SaleView`.
- Rota `reconcile`: roda as duas filas e responde `{ visited, fiscal }`.
- Painel: leituras (`getSaleDetail`, lista, contagem) por teste de domínio; roteiro manual no navegador.

## 10. Fases seguintes

- **Fase 5B+ (quando houver provedor real):** adaptador real passando na suíte de contrato, credenciais por organização, regime normal, cancelamento e contingência.
- **Fase 6, integração de acesso:** inalterada.
