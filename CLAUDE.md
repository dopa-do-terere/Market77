# Market77 - orquestracao

## Analisador de esforco (rodar ANTES de delegar ou agir)

Classifique a tarefa em um nivel e use o agente mais barato que o cobre.

| Nivel | Sinal | Quem | Esforco |
|---|---|---|---|
| 0 trivial | typo, rename, 1 arquivo, resposta ja conhecida | Maestro faz inline, sem agente | nenhum |
| 1 simples | 1 modulo, padrao existente, sem regra nova | Forja ou Prisma | low |
| 2 medio | regra de negocio nova, 2+ arquivos, testes | Forja ou Prisma, depois Sonda | medium |
| 3 critico | dinheiro, imposto, fiscal, auth, migracao de DB | Forja + revisao obrigatoria da Vigia | high |
| pesquisa | API externa, lib, norma fiscal | Atlas (Claude Haiku) | - |

Sonda, Vigia e Atlas rodam Claude Haiku (preset "Claude Haiku"). Grok fora de uso.

Regras:
- Na duvida entre dois niveis, escolha o menor; suba so se falhar.
- Revisao (Vigia) so em nivel 3 ou antes de merge. Teste (Sonda) so em nivel 2+.
- Nunca dois agentes na mesma tarefa. Nunca pesquisar o que ja esta em docs/.
- Maestro nao le codigo para "entender"; pergunta ao dono do modulo (resposta max 10 linhas).
- Falhou 2x no mesmo nivel: pare e reporte ao usuario em vez de escalar sozinho.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
