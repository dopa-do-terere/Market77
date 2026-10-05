# Market77: sistema de design e redesenho da interface

Data: 2026-10-05
Base: fases 1 a 7, já em `main`. Nenhuma regra de negócio muda.

## 1. Objetivo

Dar ao Market77 uma interface coerente, com identidade própria, em React com Tailwind. Hoje a interface não tem CSS (nenhum arquivo `.css`), o painel do dono é HTML cru (`<nav>` com links soltos) e o PDV do totem usa estilos inline em `src/app/pdv/PdvApp.tsx`.

A referência visual é o site da Mintlify (fundo limpo, bordas finas, cantos arredondados, sombras mínimas, hero grande, modo claro e escuro), com tons de laranja do logo no lugar do verde.

Critério de sucesso: painel, PDV, login, signup e home usam os mesmos tokens e componentes; claro e escuro funcionam; os 665 testes existentes continuam passando sem alteração; `typecheck` e `next build` passam ao fim de cada fase.

Fora de escopo: grade de produtos tocáveis no PDV (o leitor de código de barras continua sendo o único jeito de adicionar item; a grade vira fase própria depois), landing de marketing, internacionalização, animações.

## 2. Decisões

| Tema | Decisão |
|---|---|
| Biblioteca de estilo | Tailwind CSS v4 |
| Dependências novas | `tailwindcss`, `@tailwindcss/postcss`, `postcss`. Nenhuma outra |
| Componentes | Próprios, em `src/ui/`, sem biblioteca de componentes nem de variantes |
| Tema | Variáveis CSS trocadas por `prefers-color-scheme`; sem classe nem JavaScript |
| Cor de marca | Escala `brand` de laranja, ancorada no gradiente do logo (`#ff9a00` a `#ff4d00`) |
| Fonte | Outfit, via `next/font/google` (sem dependência nova) |
| Logo | `logo-light-bg.png` e `logo-dark-bg.png` copiados de `docs/assets/` para `public/`, trocados por `prefers-color-scheme` |
| Escala do PDV | Mesmos tokens e cores, com tamanho de toque |
| Ordem | Fundação, painel, PDV e auth (três fases, cada uma revisável) |

## 3. Fase A: fundação

- `postcss.config.mjs` com `@tailwindcss/postcss`.
- `src/app/globals.css`: `@import "tailwindcss"`, bloco `@theme` e as variáveis de tema.
- Tokens no `@theme`:
  - `brand` de 50 a 950 (laranja).
  - Neutros quentes para fundo, superfície, borda e texto, definidos como variáveis semânticas (`--color-bg`, `--color-surface`, `--color-border`, `--color-fg`, `--color-muted`) que mudam no escuro.
  - Raios 8, 12 e 16 px; sombras mínimas.
- Contraste: texto sobre fundo laranja usa `brand-700` ou mais escuro. Branco sobre `#ea580c` não atinge AA em texto pequeno; botão primário usa `brand-600` só com texto grande e em negrito, ou `brand-700`.
- `src/app/layout.tsx` importa `globals.css` e aplica a fonte no `<body>`.
- `public/logo-light-bg.png` e `public/logo-dark-bg.png`. O README continua apontando para `docs/assets/`.
- Página `/ui`, só quando `NODE_ENV !== "production"`, mostrando todos os componentes e variantes. Serve de verificação visual.

## 4. Componentes (`src/ui/`)

Cada componente é uma função React que recebe props de variante e `className`, e devolve markup com classes Tailwind. Server component por padrão; `"use client"` só onde houver estado.

| Componente | Variantes |
|---|---|
| `Button` | `primary`, `secondary`, `ghost`; tamanhos `md` e `touch` (altura mínima 64 px) |
| `Card` | padrão, com cabeçalho |
| `Input`, `Select`, `Label` | estado de erro |
| `Table` | cabeçalho sutil, linha com borda fina |
| `Badge` | `neutral`, `success`, `warning`, `danger`, `brand` |
| `Alert` | `info`, `success`, `warning`, `danger` |
| `PageHeader` | título, descrição e área de ações |
| `Sidebar` | itens com estado ativo |
| `Logo` | troca claro e escuro |

## 5. Fase B: painel do dono

- `src/app/o/[orgId]/layout.tsx`: sidebar fixa em tela larga, menu recolhível no celular. Mesmos links e mesmas checagens `can(role, ...)` de hoje; logo no topo; botão Sair continua enviando `logoutAction`.
- Migração das páginas para os componentes: painel, mercados (lista e detalhe, incluindo acesso), produtos, vendas (lista e detalhe), totens, equipe e pagamentos.
- Status de venda, validade e totem viram `Badge`. Formulários ficam em `Card`.
- Formulários e ações de servidor não mudam; só o markup ao redor.

## 6. Fase C: PDV, auth e home

- `PdvApp.tsx`: remove os estilos inline (`CSSProperties`) e usa classes Tailwind. Escala de toque: texto de 24 px ou mais, botões `touch`, alto contraste, sem estados de hover, `select-none`. Lógica, estados, `createScanner` e polling não mudam.
- Login e signup: card centralizado com logo.
- Home (`src/app/page.tsx`): redireciona ou aponta para login como hoje, com o mesmo visual.

## 7. Testes e verificação

- Regra: nenhum teste existente é editado. Os 665 seguem passando.
- Teste novo (`tests/ui/components.test.tsx`) com `renderToString` do `react-dom/server` no vitest, sem dependência nova: cada componente renderiza, e cada variante aplica a classe esperada.
- Ao fim de cada fase: `npm test`, `npm run typecheck`, `npm run build`.
- Verificação visual ao fim de cada fase, no Chrome: claro e escuro; painel em desktop e celular; PDV em viewport de totem.

## 8. Riscos

- O vitest hoje pode não ter ambiente para `.tsx`. Se a configuração exigir ajuste (`include` de `tests/**/*.tsx`, JSX automático), o ajuste fica em `vitest.config.ts` e é o único toque em configuração de teste.
- A tela do PDV roda em Chromium de totem. Tailwind v4 exige navegador recente (Chrome 111 ou mais); o agente do totem instala Chromium atual, mas a versão mínima deve ser conferida na fase C.
- Mudar o markup do PDV não pode quebrar o foco do campo do leitor. A fase C verifica isso manualmente com o leitor ou o simulador.
