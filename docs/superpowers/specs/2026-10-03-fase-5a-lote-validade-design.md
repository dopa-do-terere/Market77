# Market77: fase 5A, lote e validade

Data: 2026-10-03
Status: aguardando revisão do usuário
Base: `docs/superpowers/specs/2026-10-01-market77-design.md` (seções 3, 4, 6 e 8) e as fases 1 a 4, já em `main`.

## 1. Objetivo

O dono controla a validade dos produtos perecíveis: cada entrada de estoque informa a data de validade, a venda baixa sempre o lote que vence primeiro (FEFO), o painel avisa o que está vencendo ou vencido, e o totem não vende um produto cujo saldo inteiro está vencido. A fase 5 do roadmap ("lote/validade completo + NFC-e") foi dividida: esta é a **5A**; a NFC-e é a **5B**, com spec própria, porque depende de decisões externas (provedor fiscal, certificado digital, regime tributário, NCM/CFOP/CEST).

Fora desta fase: NFC-e, janela de alerta configurável, e-mail ou push de vencimento, relatório de perdas por validade, mover lote entre mercados, devolução ao fornecedor.

## 2. Decisões

| Tema | Decisão |
|---|---|
| Quem controla validade | Opcional por produto no mercado: `market_products.tracks_expiry` (padrão falso). Sem controle, nada muda em relação às fases anteriores |
| Lote | Um lote por produto no mercado e data de validade (`unique (market_product_id, expires_on)`). Uma nova entrada com a mesma data soma no lote existente |
| Saldo | O livro-razão continua sendo a única fonte: `stock_movements` ganha `lot_id` e o saldo de um lote é a soma dos movimentos dele. O saldo do produto continua sendo a soma de todos os movimentos |
| Saldo antigo | Movimentos sem lote (`lot_id` nulo) são o "saldo sem lote" do produto. Ele sai por último no FEFO |
| Baixa | FEFO na confirmação do pagamento, na mesma transação de hoje. Lotes vencidos entram na ordem (o item físico mais antigo sai primeiro) |
| Falta de saldo | Regra atual: o saldo pode ficar negativo. O excedente é lançado sem lote |
| Vencimento | Alerta no painel e bloqueio de venda no totem só quando todo o saldo positivo do produto está em lotes vencidos |
| Janela de alerta | Fixa em 7 dias |
| Fuso | Dia de validade = data civil em `America/Sao_Paulo`. Um lote vence quando `expires_on` é anterior à data de hoje nesse fuso (no dia indicado ele ainda vale) |

## 3. Modelo de dados (migration `0006_lots.sql`)

**`market_products`**: coluna `tracks_expiry boolean not null default false`.

**`stock_lots`** (nova): `id`, `org_id`, `market_product_id`, `expires_on date not null`, `received_at timestamptz default now()`. Chave composta `(market_product_id, org_id)` para `market_products`, `unique (id, org_id)`, `unique (market_product_id, expires_on)`, índice em `(market_product_id, expires_on)`. RLS no mesmo padrão das outras tabelas (`org_id` por `app.org_id`), `GRANT SELECT, INSERT` ao papel `market77_app` (sem `UPDATE` nem `DELETE`: o lote é só um rótulo, o saldo vive nos movimentos).

**`stock_movements`**: coluna `lot_id uuid` nula, com chave composta `(lot_id, org_id)` para `stock_lots (id, org_id)`.

**Índice de idempotência da venda**: o índice atual `stock_movements_sale_item_idx` é único em `(sale_id, market_product_id)` para `type = 'sale'`. Uma venda que atravessa dois lotes gera dois movimentos do mesmo produto, então o índice é recriado como `(sale_id, market_product_id, coalesce(lot_id, '00000000-0000-0000-0000-000000000000'::uuid))`. Continua impedindo baixa em duplicidade.

Sem backfill: os movimentos existentes ficam com `lot_id` nulo e valem como saldo sem lote.

## 4. Domínio

**`src/domain/lots.ts`** (novo), funções puras sobre `tx`:
- `todayBR(now)`: data civil em `America/Sao_Paulo`.
- `getOrCreateLot(tx, orgId, marketProductId, expiresOn)`: `insert ... on conflict do nothing`, depois `select`.
- `listLotBalances(tx, marketProductId)`: lotes com saldo (soma dos movimentos por `lot_id`), ordenados por `expires_on`, mais o saldo sem lote.
- `allocateFefo(tx, marketProductId, quantity)`: devolve `[{ lotId: string | null, quantity }]`. Percorre os lotes com saldo positivo por `expires_on` crescente (vencidos incluídos), depois o saldo sem lote positivo, e o que sobrar vai para `lotId: null`. Quantidade sempre positiva, soma igual à pedida.

**Concorrência.** Duas confirmações do mesmo produto não podem ler o mesmo saldo de lote. Antes de alocar, a transação trava as linhas de `market_products` envolvidas com `select id from market_products where id = any($1) order by id for update`. A ordem de locks fica: venda, pagamento, produtos no mercado (em ordem de id). `recordMovement` de produto com controle trava a linha do produto do mesmo jeito.

**`recordMovement`** (`src/domain/stock.ts`), para produto com `tracks_expiry`:
- `in` e `adjustment` positivo exigem `expiresOn` (data válida, hoje ou futura); o movimento grava o `lot_id` do lote da data.
- `loss` e `adjustment` negativo aceitam `lotId` opcional; sem ele, usa `allocateFefo` e pode gerar mais de um movimento. Com `lotId`, o lote precisa pertencer ao produto, senão `not_found`.
- Produto sem controle: igual a hoje; `expiresOn` e `lotId` são ignorados.

**Baixa da venda** (`confirmPayment`, `src/domain/payments.ts`): o `insert ... select` único é dividido. Itens de produto sem controle seguem o `insert ... select` atual. Para cada item de produto com controle, `allocateFefo` e um movimento `sale` por lote (`lot_id` nulo para o excedente). Tudo na mesma transação e depois de `update sales ... 'paid'`, como hoje.

**Bloqueio no totem** (`addItemByBarcode`, `src/domain/sales.ts`): se o produto controla validade, lança `AppError("product_expired")` quando `saldo vencido > 0` e `saldo válido <= 0`, onde saldo válido é a soma dos movimentos com `lot_id` nulo ou em lote não vencido, e saldo vencido é a soma dos movimentos em lotes vencidos. Sem lotes, ou com saldo válido positivo, nada muda. Item já no carrinho não é reavaliado, e pagamento confirmado nunca é bloqueado.

**Alertas** (`src/domain/lots.ts`): `listExpiryAlerts(tx, marketId, now)` devolve os lotes com saldo positivo que vencem em até 7 dias ou já venceram: produto, validade, quantidade, situação (`expired` ou `expiring`). A página inicial do dono mostra, por mercado, quantos lotes já venceram (a partir dos mesmos alertas, como já faz com o estoque baixo).

**Mensagem** (`src/lib/messages.ts`): `product_expired`: "Produto vencido. Procure o atendimento." O status HTTP em `src/pdv/http.ts` é 404, como `product_inactive`.

## 5. Painel do dono

- Configuração do produto no mercado: caixa "Controla validade". Desligar mantém os lotes e os ignora; ligar com saldo existente deixa esse saldo como "sem lote".
- Entrada de estoque (`markets/[marketId]`): campo `<input type="date">` quando o produto controla validade, obrigatório. Perda e ajuste: `<select>` opcional de lote (validade e saldo), em branco usa FEFO.
- Seção "Validade" no mercado: tabela de `listExpiryAlerts`. A página inicial do dono mostra a contagem de lotes vencidos por mercado, com link para o mercado.
- Permissão: a mesma `stock:move` de hoje.

## 6. Erros e bordas

- Entrada com data passada ou formato inválido: `invalid_input` (400); nenhum lote é criado.
- `lotId` de outro produto ou de outra organização: `not_found`; RLS impede o vazamento.
- Duas entradas simultâneas na mesma data: o `on conflict` garante um lote só.
- Baixa maior que a soma dos lotes: excedente sem lote, saldo do produto pode ficar negativo (regra atual), venda sinalizada como hoje.
- Desligar `tracks_expiry` entre a venda e a confirmação: a confirmação lê a flag dentro da transação; vale o valor lido sob o lock do produto.
- Lote vencido ainda com saldo e produto com outro lote válido: o totem vende; o FEFO baixa o vencido primeiro e o alerta continua listando o que sobrar dele.

## 7. Testes

- Unitário (`allocateFefo`): 1, 2 e 3 lotes; venda que atravessa lotes; lote sem validade (sem lote) por último; excedente sem lote; quantidade exata no limite do lote.
- Domínio: entrada cria e reutiliza o lote da mesma data; entrada sem `expiresOn` ou com data passada é recusada; perda com `lotId` e sem `lotId`; produto sem controle inalterado.
- Venda: `confirmPayment` com produto com controle gera um movimento por lote; idempotência (segunda confirmação não baixa de novo); duas confirmações concorrentes do mesmo produto não consomem o mesmo saldo (teste com duas transações).
- Bloqueio: sem lote, só vencido, vencido mais válido, só sem lote; a flag desligada não bloqueia.
- Alertas: janela de 7 dias, vencidos, lote zerado não aparece.
- Segurança: RLS em `stock_lots` (organização A nunca lê nem usa lote da B).
- HTTP: `POST /api/pdv/sales/items` devolve 404 com a mensagem em português para produto vencido.
- Manual: entrada com validade no painel, venda no totem, alerta de vencendo e totem recusando o produto vencido.

## 8. Fases seguintes

- **5B, NFC-e:** spec própria depois que o provedor fiscal for escolhido.
- **6, integração de acesso:** inalterada.
