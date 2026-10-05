<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/logo-dark-bg.png">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/logo-light-bg.png">
    <img alt="Market77" src="docs/assets/logo-light-bg.png" width="420">
  </picture>
</p>

<p align="center">
  Plataforma SaaS para mercados autônomos: catálogo, estoque, totem de autoatendimento, Pix e cartão.
</p>

## O que já existe

| Fase | Entrega |
|---|---|
| 1 | Base multi-tenant (Postgres com Row Level Security), catálogo e estoque por livro-razão |
| 2 | PDV do totem, venda e Pix |
| 3 | Agente do totem, heartbeat e comandos remotos |
| 4 | Cartão na maquininha (adaptador simulado) |
| 5A | Lote e validade |
| 5B | NFC-e (provedor simulado) |
| 6 | Registro de acessos (leitor facial simulado) |

Stack: Next.js 15, React 19, TypeScript, Postgres 16 (`postgres.js`, migrations em SQL puro), `zod` e `vitest`. Specs e planos de cada fase ficam em `docs/superpowers/`.

## Rodar localmente

1. `docker compose up -d`
2. `cp .env.example .env`
3. `npm install`
4. `npm run db:migrate`
5. `npm run dev` e abrir http://localhost:3000

## Totem (fase 2)

1. No painel, em **Totens**, cadastre um totem para o mercado e copie o token (ele aparece uma vez).
2. No navegador do totem, abra `/pdv` e cole o token. Cadastre antes produtos com código de barras e coloque-os à venda no mercado.
3. Escaneie (o leitor funciona como teclado) e toque em **Pagar com Pix**.
4. Em desenvolvimento o Pix é simulado. Para "pagar" a cobrança mostrada no QR, use o identificador depois de `FAKEPIX|` do código copia e cola:
   `curl -X POST http://localhost:3000/api/dev/fake-pix/<identificador>/pay`
5. Variáveis: `PIX_PROVIDER=fake`, `FAKE_PIX_SECRET` (assinatura do webhook simulado) e `RECONCILE_SECRET` (rota `POST /api/internal/reconcile`, que um agendador deve chamar a cada minuto em produção (veja abaixo)).

O adaptador `fake` e a rota de pagamento simulado recusam funcionar com `NODE_ENV=production`.

## Agente do totem (fase 3)

O agente roda no mini PC (Ubuntu): abre o PDV em tela cheia, envia um heartbeat a cada 30 s e executa os comandos que o dono manda pelo painel (**Totens**: Reiniciar PDV, Reboot, Atualizar agente). O servidor nunca conecta no totem; o agente é quem pergunta.

**Publicar uma versão do agente** (no servidor ou na sua máquina, com `RELEASE_SECRET` no `.env`):

```bash
npm run agent:release -- 1.0.0 https://seu-servidor
```

**Instalar em um totem:** cadastre o totem no painel e copie o token. No mini PC:

```bash
curl -fsSL -H "Authorization: Bearer <token>" https://seu-servidor/api/agent/releases/1.0.0 -o agent.tgz
mkdir agent && tar -xzf agent.tgz -C agent && cd agent
sudo ./install.sh https://seu-servidor <token>
sudo reboot
```

O instalador coloca Node 22.18+ e o Chromium, cria o usuário `kiosk` (autologin em X11), a regra `sudoers` só para `systemctl reboot`, o serviço `market77-agent` e o `market77-watchdog`, que volta à versão anterior se uma atualização não der heartbeat em 2 minutos.

**Atualizar:** publique uma versão nova com `agent:release` e use **Atualizar agente** no painel. O agente baixa o pacote, confere o SHA-256, troca a versão e reinicia sozinho.

Um totem sem batida há mais de 2 minutos aparece como **offline** (o painel também mostra a contagem). Um comando que fica mais de 10 minutos na fila expira e nunca roda depois.

**Em produção (Firebase App Hosting, Cloud Run ou outra hospedagem sem cron):** agende uma chamada por minuto, por exemplo no Cloud Scheduler:

```bash
curl -X POST https://seu-servidor/api/internal/reconcile -H "x-reconcile-secret: $RECONCILE_SECRET"
```

O pacote do agente fica no Postgres (limite de 20 MB). Variáveis novas: `RELEASE_SECRET` (publicar pacote).

## Cartão (fase 4)

O totem tem os botões **Pagar com Pix** e **Pagar com cartão**. No cartão a tela pede para seguir as instruções na maquininha (2 minutos), com o botão **Cancelar**. Aprovação paga a venda e baixa o estoque como no Pix; recusa, cancelamento e tempo esgotado devolvem o carrinho com o motivo.

Ainda não há maquininha real escolhida: em desenvolvimento o cartão é simulado (`CARD_PROVIDER=fake`). Para "passar o cartão" de uma cobrança, pegue o identificador do pagamento (`select external_id from payments order by created_at desc limit 1`) e use:

```bash
curl -X POST http://localhost:3000/api/dev/fake-card/<identificador>/approve
curl -X POST http://localhost:3000/api/dev/fake-card/<identificador>/decline
```

Variáveis: `CARD_PROVIDER=fake` e `FAKE_CARD_SECRET` (assinatura do webhook simulado). O webhook do provedor de cartão é `POST /api/webhooks/card/<provedor>`. O adaptador `fake` de cartão e as rotas `/api/dev/fake-card` recusam funcionar com `NODE_ENV=production`.

Um adaptador real implementa a interface `CardProvider` (`src/payments/card.ts`) e passa na suíte de contrato `tests/payments/card-contract.ts`. Se a maquininha escolhida exigir SDK local, será preciso uma ponte pelo agente do totem (fase própria).

## Lote e validade (fase 5A)

Em **Mercados**, ao adicionar ou atualizar um produto, marque **Controla validade** para os perecíveis. Para esses produtos:

- Toda **entrada** exige a data de validade. Entradas na mesma data somam no mesmo lote.
- A **venda** baixa sempre o lote que vence primeiro (FEFO). Perda e ajuste negativo fazem o mesmo, ou baixam um lote escolhido.
- A seção **Validade** do mercado lista os lotes vencidos e os que vencem em 7 dias, e a página inicial mostra quantos lotes já venceram.
- O totem recusa ("Produto vencido. Procure o atendimento.") um produto cujo saldo inteiro está em lotes vencidos. O produto sai da prateleira e a perda é registrada em **Movimentar**.

O saldo que já existia antes de ligar o controle continua valendo como "saldo sem lote" e sai por último. A NFC-e será a fase 5B.

## NFC-e (fase 5B)

Cada venda paga de um mercado com **Emitir NFC-e** ligada gera uma nota fiscal, emitida em segundo plano. A venda continua paga mesmo se a nota falhar.

1. Em **Mercados**, abra o mercado e preencha **Dados fiscais (NFC-e)**: CNPJ, inscrição estadual, UF e série. Só o Simples Nacional emite; o regime normal fica registrado, mas a nota vai para erro.
2. Em **Produtos**, abra **Dados fiscais** de cada produto e informe o NCM (8 dígitos). CFOP, CSOSN, unidade e origem já vêm com valores padrão do Simples (5102, 102, UN, 0).
3. No totem, o cliente pode tocar em **CPF na nota** antes de pagar. Sem CPF, a nota sai como consumidor não identificado.
4. A fila é processada pela mesma chamada de cada minuto da rota `POST /api/internal/reconcile` (ela responde `{ visited, fiscal }`). Provedor fora do ar: nova tentativa em 1, 2, 4... até 60 minutos, 8 vezes; depois a nota fica **Com erro**. Dados inválidos (NCM ausente, CNPJ inválido, regime normal) ficam **Com erro** na hora.
5. Em **Vendas**, o detalhe mostra a nota (número, chave, DANFE e a última falha) e o botão **Reemitir** para as que ficaram com erro, depois de corrigir o cadastro. A lista e a página inicial avisam quantas notas estão com erro.

Ainda não há provedor fiscal escolhido: em desenvolvimento a nota é simulada (`FISCAL_PROVIDER=fake`). Para testar falhas, troque o modo do simulador:

```bash
curl -X POST http://localhost:3000/api/dev/fake-fiscal/mode -d '{"mode":"down"}'   # ok | down | reject | lost
```

Enquanto não houver provedor fiscal real, não ligue **Emitir NFC-e** em produção: com o simulador, cada nota fica 8 vezes indisponível por cerca de 2 horas e vira erro.

O adaptador `fake` e essa rota recusam funcionar com `NODE_ENV=production`. Um provedor real implementa `FiscalProvider` (`src/fiscal/provider.ts`) e passa na suíte de contrato `tests/fiscal/fiscal-contract.ts`. Fica para depois: cancelamento de nota, contingência offline, regime normal, credenciais por organização.

## Acessos (fase 6)

O dono vê quem entra no mercado e quando. Um leitor (por exemplo um leitor facial) manda cada entrada para o Market77; o Market77 **nunca guarda imagem nem template facial**, só o identificador da pessoa e a hora. O nome vem de um cadastro sincronizado com o leitor.

1. Em **Mercados**, abra o mercado e entre em **Acessos** (só o dono vê esta tela). Cadastre um **leitor** e copie o token: ele aparece uma única vez.
2. O leitor envia cada entrada com o token:

```bash
curl -X POST http://localhost:3000/api/access/events \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"occurredAt":"2026-10-05T14:30:00-03:00","eventId":"abc123","personId":"u-42"}'
```

   `eventId` (opcional) evita duplicar a mesma entrada; `personId` (opcional) é o identificador da pessoa no leitor. Só esses campos são guardados. A data pode ter até 5 minutos de adiantamento e 7 dias de atraso.
3. A lista de pessoas é puxada do leitor pela chamada de cada minuto da rota `POST /api/internal/reconcile` (que também responde `access: { synced, purged }`): cada leitor é sincronizado a cada 10 minutos. Quem some da lista do leitor fica inativo.
4. A tela mostra o resumo por dia (entradas, pessoas, vendas pagas e vendas por entrada, no fuso do mercado), as entradas por hora de um dia, os acessos recentes com o nome, as pessoas e os leitores (com o erro da última sincronização, se houver).
5. **Esquecer pessoa** (pedido de exclusão) apaga o nome, tira o identificador dos acessos antigos e impede a sincronização de recriar a pessoa.
6. Os acessos ficam 90 dias; a limpeza roda na mesma chamada de cada minuto.

Rosto é dado biométrico, dado pessoal sensível pela LGPD: a base legal (em geral consentimento específico dos moradores) e o aviso a eles são responsabilidade de quem opera o condomínio.

Ainda não há leitor escolhido: em desenvolvimento a lista de pessoas é simulada (`ACCESS_PROVIDER=fake`):

```bash
curl -X POST http://localhost:3000/api/dev/fake-access/people \
  -d '{"sourceId":"<id do leitor>","people":[{"externalId":"u-42","name":"Ana Souza"}]}'
curl -X POST http://localhost:3000/api/dev/fake-access/mode -d '{"mode":"down"}'   # ok | down
```

O `fake` e essas rotas recusam funcionar com `NODE_ENV=production`. Um leitor real implementa `AccessProvider` (`src/access/provider.ts`) e passa na suíte de contrato `tests/access/access-contract.ts`. Fica para depois: abrir a porta, câmeras, eventos de saída e de acesso negado.

## Testes

`docker compose up -d && npm test` (usa o banco `market77_test`).

## Produção

Troque a senha do papel `market77_app` (`ALTER ROLE market77_app PASSWORD '...'`) e use essa senha em `DATABASE_APP_URL`.
