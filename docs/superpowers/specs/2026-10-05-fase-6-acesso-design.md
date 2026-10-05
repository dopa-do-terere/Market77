# Market77: fase 6, registro de acessos (leitor facial simulado)

Data: 2026-10-05
Status: aguardando revisão do usuário
Base: `docs/superpowers/specs/2026-10-01-market77-design.md` (seções 3, 4 e 8, tabela `access_events`) e as fases 1 a 5B, já em `main`.

## 1. Objetivo

O dono vê quem entra no mercado e quando: um leitor facial manda cada entrada para o Market77, que a guarda por 90 dias, mostra o nome da pessoa a partir de um cadastro sincronizado com o leitor e cruza as entradas com as vendas por dia ("42 entradas, 9 vendas"). O Market77 **nunca guarda imagem nem template facial**: a biometria fica no leitor; o Market77 só recebe o identificador da pessoa e a hora. O leitor real ainda não foi escolhido, então esta fase entrega o fluxo completo (ingestão, sincronização, painel, retenção) sobre um **provedor simulado**, atrás da interface `AccessProvider`, como foi feito com o Pix, o cartão e a NFC-e.

Rosto é dado biométrico, dado pessoal sensível pela LGPD (art. 11): a base legal (em geral consentimento específico dos moradores) e o aviso aos moradores são responsabilidade do operador do condomínio, não do código. O desenho ajuda: acesso restrito ao dono, retenção limitada, nenhuma biometria guardada e a ação **Esquecer pessoa**.

Fora desta fase: abrir a porta, câmeras, imagem ou template facial no Market77, tipos de evento além de entrada (saída, negado), eventos puxados do equipamento (aqui eles chegam por push), provedor real, alertas em tempo real, deduplicar a mesma pessoa entre leitores diferentes.

## 2. Decisões

| Tema | Decisão |
|---|---|
| Eventos | Push: o leitor chama `POST /api/access/events` com o token dele. Nenhum payload livre: só os campos da seção 4 |
| Pessoas | Pull: o Market77 sincroniza a lista de pessoas de cada leitor pela interface `AccessProvider`, a cada 10 minutos, pela chamada de cada minuto da rota `reconcile` |
| Biometria | Nunca entra no Market77 (nem imagem, nem template). O campo extra que o equipamento mandar é descartado |
| Quem vê | Só o dono (`access:read` e `access:write`). Gerente e repositor não veem o nome de quem entra |
| Retenção | 90 dias (`ACCESS_RETENTION_DAYS = 90`), limpeza na chamada de cada minuto, em lotes |
| Esquecer | Ação do dono: apaga o nome, anula o identificador nos eventos antigos e impede a sincronização de recriar a pessoa |
| Dia | Data civil no fuso do mercado, em todos os resumos |
| Leitor sem provedor real | `ACCESS_PROVIDER=fake`; o adaptador simulado recusa `NODE_ENV=production` |

## 3. Modelo de dados (migration `0008_access.sql`)

**`access_sources`** (um por leitor ou porta): `id`, `org_id`, `market_id`, `name text` (2 a 60 caracteres, aparece como "origem"), `token_hash text not null unique` (SHA-256 do token, que é mostrado uma vez, como o dos totens), `created_at`, `revoked_at`, `last_sync_at` (qualquer tentativa de sincronização), `last_sync_error text` (nulo quando a última deu certo), `last_event_at`. `UNIQUE (id, org_id)`, chave composta `(market_id, org_id)` para `markets`.

**`access_people`** (cadastro vindo do leitor): `id`, `org_id`, `source_id`, `external_id text` (1 a 64 caracteres), `name text` (nulo quando a pessoa foi esquecida), `active boolean not null default true`, `forgotten_at timestamptz`, `synced_at`, `created_at`. `UNIQUE (source_id, external_id)`, chave composta `(source_id, org_id)` para `access_sources`.

**`access_events`**: `id`, `org_id`, `market_id`, `source_id`, `occurred_at timestamptz not null`, `received_at timestamptz not null default now()`, `kind text not null default 'entry' CHECK (kind IN ('entry'))`, `person_external_id text` (nulo quando o leitor não identificou ou a pessoa foi esquecida; no máximo 64 caracteres), `event_id text` (opcional, do equipamento; no máximo 64 caracteres). Único parcial `(source_id, event_id) WHERE event_id IS NOT NULL`. Índices `(market_id, occurred_at)` e `(occurred_at)` (retenção). Chaves compostas `(source_id, org_id)` e `(market_id, org_id)`.

**RLS** no padrão das outras tabelas (política `tenant_isolation` por `org_id`). **Grants** ao papel da aplicação: `SELECT, INSERT, UPDATE` nas três tabelas, sem `DELETE`. A retenção apaga com o `adminSql` (como a fila fiscal usa o `adminSql` para descobrir organizações); a anulação de eventos ao esquecer uma pessoa é um `UPDATE`.

## 4. API de ingestão

`POST /api/access/events`, `Authorization: Bearer <token do leitor>`, corpo JSON:

```json
{ "occurredAt": "2026-10-05T14:30:00-03:00", "eventId": "abc123", "personId": "u-42", "kind": "entry" }
```

- `occurredAt` obrigatório (ISO 8601 com fuso); `eventId`, `personId` e `kind` opcionais (`kind` só `entry`). Qualquer outro campo é descartado.
- `occurredAt` no futuro por mais de 5 minutos ou com mais de 7 dias de atraso: 400 `invalid_input`.
- Repetir o mesmo `eventId` do mesmo leitor responde 200 `{ "duplicate": true }` sem gravar de novo; evento novo responde 201 `{ "id": "..." }`.
- Se o `personId` é de uma pessoa esquecida, o evento é gravado com `person_external_id` nulo.
- A autenticação (`src/access/auth.ts`) resolve o token com `adminSql` antes de conhecer o tenant, como `requireTerminal`; o resto passa por `withOrg`. Token ausente ou desconhecido: 401 `unauthorized` ("Leitor não autorizado."); leitor revogado: 401 `source_revoked` ("Leitor desativado."); JSON quebrado ou campo inválido: 400. Nunca 500.
- Cada evento aceito atualiza `access_sources.last_event_at`.

## 5. Provedor, sincronização e retenção

**`src/access/provider.ts`**: `interface AccessProvider { name: string; listPeople(source: { id: string; marketId: string; name: string }): Promise<{ externalId: string; name: string }[]> }` e o erro `AccessUnavailable`. Chamadas com `withTimeout` de 5 s.

**`src/access/fake-access.ts`**: guarda em memória (`globalThis`) a lista de cada leitor (`sourceId`) e um modo (`ok`, `down`). Leitor sem lista devolve lista vazia. Recusa `NODE_ENV=production`. Rotas de desenvolvimento: `POST /api/dev/fake-access/people` com `{ "sourceId", "people": [{ "externalId", "name" }] }` e `POST /api/dev/fake-access/mode` com `{ "mode": "ok" | "down" }`, ambas 404 em produção, 400 para entrada ruim.

**`src/access/registry.ts`**: `getAccessProvider()` lê `ACCESS_PROVIDER` (`fake`); nome desconhecido (inclusive `constructor`, `__proto__`) dá `AppError("provider_unavailable")`.

**`src/domain/access.ts`**:
- `createAccessSource(tx, orgId, { marketId, name }): Promise<{ id, token }>` e `revokeAccessSource(tx, id)`, espelhando os totens (token de 32 bytes em base64url, só o SHA-256 é guardado).
- `recordAccessEvent(tx, auth, raw, now)`: valida, deduplica (`on conflict do nothing`) e atualiza `last_event_at`.
- `syncAccessSources(now = new Date(), limit = 50, provider?)`: descobre com `adminSql` os leitores não revogados com `last_sync_at` nulo ou de 10 minutos atrás ou mais; para cada um, em `withOrg`, trava a linha (`for update skip locked`), confere de novo se está vencido, chama `listPeople` e, dentro de um `tx.savepoint`, faz upsert das pessoas em blocos de 500 (nome entre 1 e 120 caracteres, entradas sem identificador ou nome são ignoradas; pessoa esquecida mantém `name` nulo e `active` falso), desativa as que sumiram da lista, e grava `last_sync_at = now`, `last_sync_error = null`. Falha do provedor ou do SQL grava `last_sync_at = now` e `last_sync_error` (mensagem curta) e mantém a lista antiga. Uma lista vazia é válida. Um leitor com erro não interrompe os outros. Devolve quantos foram sincronizados.
- `purgeAccessEvents(now, limit = 5000)`: com `adminSql`, apaga em um `delete ... where id in (select id ... where occurred_at < cutoff order by occurred_at limit N)` e devolve quantos apagou; `cutoff = now - ACCESS_RETENTION_DAYS`, calculado do `now` recebido.
- `forgetAccessPerson(tx, personId, now)`: marca `forgotten_at`, apaga `name`, `active = false`, e anula `person_external_id` dos eventos daquele leitor com aquele identificador; idempotente; id inexistente ou malformado dá `not_found`.

A rota `POST /api/internal/reconcile` passa a devolver `{ visited, fiscal, access: { synced, purged } }`, com cada fila isolada das outras.

## 6. Leituras do painel (`src/domain/access.ts`)

- `listAccessSources(tx, marketId)`: nome, criação, revogação, `lastSyncAt`, `lastSyncError`, `lastEventAt`, quantidade de pessoas ativas.
- `listAccessPeople(tx, marketId)`: leitor, identificador, nome, ativa, esquecida.
- `listRecentAccess(tx, marketId, limit = 100)`: hora, leitor, identificador, nome (resolvido por `(source_id, external_id)`), situação (`known`, `unregistered`, `anonymous`, `forgotten`).
- `dailyAccessSummary(tx, marketId, now, days = 14)`: uma linha por dia (inclusive os sem eventos), no fuso do mercado, com `entries`, `people` (distintas por `(source_id, person_external_id)`; ponytail: a mesma pessoa em dois leitores conta duas vezes), `paidSales` (vendas pagas do mercado, por `paid_at`) e `salesPerEntry` (`paidSales / entries`, nulo sem entradas).
- `hourlyAccess(tx, marketId, day)`: 24 linhas (`hour`, `entries`) do dia escolhido (`AAAA-MM-DD`, validado) no fuso do mercado.

## 7. Painel do dono

Nova tela `markets/[marketId]/access`, com link na página do mercado, visível só com `access:read`:
- **Leitores:** formulário para cadastrar (`access:write`), o token exibido uma única vez (como o do totem), revogar, e a última sincronização, o último evento e o erro de sincronização.
- **Pessoas:** lista com a ação **Esquecer pessoa** (`access:write`).
- **Acessos recentes:** os últimos 100, com a hora no fuso do mercado e "Pessoa não cadastrada (id ...)", "Não identificada" ou "Pessoa removida a pedido" quando for o caso.
- **Resumo:** tabela por dia (entradas, pessoas, vendas, vendas por entrada com duas casas) e a tabela por hora do dia escolhido (`?day=`).
- **Permissões:** `access:read` e `access:write` só para o dono (`src/auth/permissions.ts`).

## 8. Erros e bordas

- Evento de leitor de outro mercado ou organização: impossível por construção (o token resolve o leitor e o mercado); nenhuma escolha de mercado vem do corpo.
- Leitor revogado: deixa de aceitar eventos e de sincronizar; o histórico fica até a retenção.
- Pessoa esquecida nunca volta pela sincronização; eventos novos dela entram sem identificador.
- Equipamento fora do ar na sincronização: lista antiga mantida, erro visível no painel, nova tentativa em 10 minutos.
- Lista vazia do equipamento desativa todas as pessoas do leitor (aceito; reativam quando voltam a aparecer).
- Fuso: todo agrupamento por dia ou hora usa o fuso do mercado (`markets.timezone`), nunca UTC.
- Limpeza de retenção em lotes de 5000 por chamada; o excedente sai nas chamadas seguintes.
- Entradas ruins nunca dão 500: JSON quebrado, campos inválidos, token ruim, ids malformados e `?day=` inválido viram 400, 401 ou 404.

## 9. Testes

- Schema: constraints, unicidade (`(source_id, external_id)`, `(source_id, event_id)`), RLS, grants (sem `DELETE`).
- Token do leitor: criar (mostrado uma vez, só o hash guardado), revogar, autenticação (válido, desconhecido, revogado).
- Ingestão: válido, repetido (200 sem duplicar), futuro, antigo, campos extras descartados, campos inválidos, JSON quebrado, token errado, pessoa esquecida.
- Provedor: contrato do adaptador, modos `ok` e `down`, produção recusada, registro (inclusive `constructor`).
- Sincronização: upsert, desativar, reativar, nomes inválidos ignorados, lista vazia, falha mantém a lista e grava o erro, limite de 10 minutos, pessoa esquecida ignorada, um leitor ruim não para os outros, dois processadores juntos, falha de SQL no meio conta como falha (savepoint).
- Retenção: apaga só o que passou de 90 dias (a partir do `now` recebido), respeita o limite do lote.
- Esquecer pessoa: nome apagado, eventos anulados, idempotente, `not_found`.
- Resumos: por dia e por hora no fuso do mercado (evento perto da meia-noite), dias sem eventos, cruzamento com vendas pagas, `?day=` inválido.
- Permissões: dono vê e administra; gerente e repositor não.
- Rota `reconcile`: devolve `{ visited, fiscal, access }` e roda as três filas isoladas.
- Roteiro HTTP com servidor real e roteiro manual no navegador.

## 10. Fases seguintes

- **Leitor real:** adaptador que passa na suíte de contrato, credenciais por organização, eventos de saída e de acesso negado.
- **Fase 5B+:** provedor fiscal real, regime normal, cancelamento de nota.
