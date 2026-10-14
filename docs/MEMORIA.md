# Memoria do projeto Market77

Fonte unica de contexto minimo. Leia ao iniciar. Mantenha curta (max ~80 linhas): ao crescer, comprima o Log.

## Projeto
SaaS para mercados autonomos (Next.js 15, React 19, TypeScript, PostgreSQL 16, vitest). Multi-tenant via `withOrg()`. Provedores atras de contratos (`PaymentProvider`, `CardProvider`, `FiscalProvider`, `AccessProvider`) com fake e real. Fases 1-7 concluidas; ver README (Roadmap) e docs/superpowers/.

## Time no Maestri (workspace MARKET77)
- Claude Code = Maestro: planeja, delega, integra. Nao le codigo para "entender".
- Forja (Codex) backend: src/domain, db, fiscal, payments, auth, access.
- Prisma (Codex) frontend: src/ui, app, pdv.
- Sonda (Claude Haiku) QA: tests/. Vigia (Claude Haiku) revisor, so leitura. Atlas (Claude Haiku) pesquisa, escreve so em docs/.
- Papeis: `maestri role list`. Presets: "Claude Haiku", "Grok" (fora de uso).
- Checklist vivo: nota "Checklist Market77" (`maestri note read`).

## Regras
- Analisador de esforco (niveis 0-3) em CLAUDE.md; menor nivel que cobre a tarefa.
- graphify antes de grep: `graphify query|explain|path`; `graphify update .` apos mudar codigo.
- Respostas de agentes ao Maestro: max 10 linhas. Commits pequenos, sem push sem autorizacao.
- Usuario: responder em pt-BR, sem emojis em nada.
- Falhou 2x no mesmo nivel: parar e reportar.

## Decisoes
- 2026-10-14 Grok substituido por Claude Haiku (Claude tem mais tokens).
- 2026-10-14 graphify instalado (hooks Claude e Codex, git post-commit); graphify-out/ e .maestri/ no .gitignore.
- Pendente decisao do usuario: provedor fiscal NFC-e real (item A1 do checklist).

## Log (mais novo no topo; 1 linha por marco)
- 2026-10-14 Time recrutado, checklist criado, memoria criada. Branch feat/design-system, commit 58c537b.
