# Market77

Plataforma SaaS para mercados autônomos. Fase 1: base multi-tenant, catálogo e estoque.

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
5. Variáveis: `PIX_PROVIDER=fake`, `FAKE_PIX_SECRET` (assinatura do webhook simulado) e `RECONCILE_SECRET` (rota `POST /api/internal/reconcile`, que será agendada na fase 3).

O adaptador `fake` e a rota de pagamento simulado recusam funcionar com `NODE_ENV=production`.

## Testes

`docker compose up -d && npm test` (usa o banco `market77_test`).

## Produção

Troque a senha do papel `market77_app` (`ALTER ROLE market77_app PASSWORD '...'`) e use essa senha em `DATABASE_APP_URL`.
