# Market77

Plataforma SaaS para mercados autônomos. Fase 1: base multi-tenant, catálogo e estoque.

## Rodar localmente

1. `docker compose up -d`
2. `cp .env.example .env`
3. `npm install`
4. `npm run db:migrate`
5. `npm run dev` e abrir http://localhost:3000

## Testes

`docker compose up -d && npm test` (usa o banco `market77_test`).

## Produção

Troque a senha do papel `market77_app` (`ALTER ROLE market77_app PASSWORD '...'`) e use essa senha em `DATABASE_APP_URL`.
