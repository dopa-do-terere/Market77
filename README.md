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
| 5A | Lote e validade (em andamento) |
| 5B | NFC-e (planejada) |

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

## Testes

`docker compose up -d && npm test` (usa o banco `market77_test`).

## Produção

Troque a senha do papel `market77_app` (`ALTER ROLE market77_app PASSWORD '...'`) e use essa senha em `DATABASE_APP_URL`.
