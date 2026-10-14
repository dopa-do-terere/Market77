# Sistema de design e redesenho da interface: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao painel do dono, ao PDV do totem e às telas de login e cadastro uma interface coerente em React com Tailwind, com laranja do logo como cor de marca e modo claro e escuro.

**Architecture:** Tailwind v4 com tokens no `@theme` de `src/app/globals.css`; variáveis CSS semânticas (`--bg`, `--fg`, ...) trocadas por `prefers-color-scheme`. Componentes próprios em `src/ui/` (funções React com props de variante), reexportados por `src/ui/index.ts`. Três ondas: fundação e componentes (tarefas 1 a 3), painel (4 a 7), auth e PDV (8 e 9). Nenhuma regra de negócio, ação de servidor, rota ou consulta muda; só o markup.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind CSS v4 (`tailwindcss`, `@tailwindcss/postcss`, `postcss`; únicas dependências novas), `vitest` (já instalado), `next/font/google` (Outfit).

**Spec:** `docs/superpowers/specs/2026-10-05-design-system-design.md`

## Global Constraints

- Dependências novas: somente `tailwindcss`, `@tailwindcss/postcss` e `postcss`. Nenhuma biblioteca de componentes, de variantes (`clsx`, `cva`, `tailwind-merge`) ou de ícones.
- Nenhum teste existente é editado. Os 665 testes atuais seguem passando. Única edição em configuração de teste: `esbuild.jsx = "automatic"` em `vitest.config.ts`.
- Nenhuma ação de servidor, rota de API, consulta ou regra de permissão muda. As checagens `can(role, ...)` e `requireOrgPage(...)` ficam exatamente onde estão.
- Texto sobre fundo laranja usa `brand-700` ou mais escuro (branco sobre `#ea580c` não passa AA em texto pequeno).
- Modo claro e escuro só por `prefers-color-scheme` (variáveis CSS e a variante `dark:` padrão do Tailwind v4); sem classe `dark` e sem JavaScript de tema.
- Componentes não aceitam sobrescrever classe que conflita com a própria (largura, altura, tamanho de texto): variação de tamanho entra por prop (`size`, `touch`), nunca por `className`.
- Escala de toque do PDV: botões com altura mínima de 64 px (`min-h-16`), texto de 24 px ou mais (`text-2xl`), sem estados de hover obrigatórios, `select-none`.
- O logo vem de `public/logo-light-bg.png` e `public/logo-dark-bg.png` (cópias de `docs/assets/`). O README continua apontando para `docs/assets/`.
- Texto da interface em pt-BR; sem emojis em código, commits ou arquivos.
- Commits em inglês, estilo Conventional Commits, terminando com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Ao fim de cada tarefa: `npm run typecheck` e `npm test` sem erros. Ao fim das tarefas 3, 7 e 9: também `npm run build`.

## Review Focus

- Badge e Alert em modo escuro: cada tom precisa de classes `dark:` (fundo escuro e texto claro), senão badge verde ou vermelho fica ilegível no escuro. Teste em `tests/ui/components.test.tsx` (Task 2).
- Alert mantém `role="alert"` para aviso e erro e `role="status"` para informação e sucesso (as páginas de hoje usam esses papéis; leitor de tela depende deles). Teste em Task 2.
- Tabela larga no celular: `Table` precisa rolar na horizontal em vez de estourar a página (totens tem 8 colunas). Teste em Task 2.
- Rota `/ui` de referência não pode existir em produção: responde 404 quando `NODE_ENV === "production"`. Teste em Task 3.
- Menu do painel só mostra o que o papel pode usar, e o layout não renderiza `<main>` (cada página já tem o seu; `<main>` aninhado é inválido). Verificação por `grep` e conferência manual com um gerente e um repositor em Task 4.

---

## Mapa de arquivos

Criar:
- `postcss.config.mjs`: liga o Tailwind ao PostCSS.
- `src/app/globals.css`: `@import "tailwindcss"`, tokens e variáveis de tema.
- `public/logo-light-bg.png`, `public/logo-dark-bg.png`: logos.
- `src/ui/cx.ts`: junta classes.
- `src/ui/Button.tsx`, `Card.tsx`, `Field.tsx` (Field, Input, Select, Checkbox), `Badge.tsx`, `Alert.tsx`, `PageHeader.tsx`, `Table.tsx`, `Logo.tsx`, `AuthShell.tsx`, `Sidebar.tsx`, `tones.ts`, `index.ts`.
- `src/app/ui/page.tsx`: página de referência (só fora de produção).
- `tests/ui/components.test.tsx`, `tests/ui/reference-page.test.tsx`.

Modificar:
- `package.json`, `package-lock.json` (3 dependências), `vitest.config.ts` (JSX automático).
- `src/app/layout.tsx` (CSS, fonte).
- `src/app/o/[orgId]/layout.tsx` e as 12 páginas e formulários do painel.
- `src/app/login/page.tsx`, `src/app/signup/page.tsx`, `src/app/pdv/PdvApp.tsx`.
- `docs/superpowers/specs/2026-10-05-design-system-design.md` (correção da home), `README.md`.

---

### Task 1: Tailwind, tokens, fonte e logo

**Files:**
- Create: `postcss.config.mjs`, `src/app/globals.css`, `public/logo-light-bg.png`, `public/logo-dark-bg.png`
- Modify: `package.json`, `package-lock.json`, `src/app/layout.tsx`

**Interfaces:**
- Produces: utilitários de cor `bg-bg`, `bg-surface`, `bg-subtle`, `border-border`, `text-fg`, `text-muted`, `text-link`, escala `brand-50` a `brand-950`; raios `rounded-md/lg/xl`; fonte `font-sans` (Outfit). Todas as tarefas seguintes usam esses nomes.

- [ ] **Step 1: Instalar as dependências**

Run: `npm install tailwindcss @tailwindcss/postcss postcss`
Expected: `package.json` ganha as três em `dependencies`; sem erros.

- [ ] **Step 2: Configurar o PostCSS**

Create `postcss.config.mjs`:

```js
export default { plugins: { "@tailwindcss/postcss": {} } };
```

- [ ] **Step 3: Criar `src/app/globals.css`**

```css
@import "tailwindcss";

:root {
  color-scheme: light dark;
  --bg: #fffdfa;
  --surface: #ffffff;
  --subtle: #faf5ef;
  --border: #e7ddd2;
  --fg: #1c1917;
  --muted: #6b625b;
  --link: #c24e00;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0c0a09;
    --surface: #171412;
    --subtle: #1f1a17;
    --border: #2f2822;
    --fg: #faf7f4;
    --muted: #a8a09a;
    --link: #ffa31a;
  }
}

/* "inline": os utilitários leem a variável na hora de usar, então o escuro troca sem recompilar. */
@theme inline {
  --color-bg: var(--bg);
  --color-surface: var(--surface);
  --color-subtle: var(--subtle);
  --color-border: var(--border);
  --color-fg: var(--fg);
  --color-muted: var(--muted);
  --color-link: var(--link);
  --font-sans: var(--font-outfit), ui-sans-serif, system-ui, sans-serif;
}

@theme {
  --color-brand-50: #fff7ed;
  --color-brand-100: #ffedd5;
  --color-brand-200: #fed7aa;
  --color-brand-300: #fdba74;
  --color-brand-400: #ffa31a;
  --color-brand-500: #ff8a00;
  --color-brand-600: #f26a00;
  --color-brand-700: #c24e00;
  --color-brand-800: #9a3f06;
  --color-brand-900: #7c350b;
  --color-brand-950: #431a03;
  --radius-md: 0.5rem;
  --radius-lg: 0.75rem;
  --radius-xl: 1rem;
  --shadow-sm: 0 1px 2px 0 rgb(28 25 23 / 0.06);
}

@layer base {
  body {
    background: var(--bg);
    color: var(--fg);
  }
}
```

- [ ] **Step 4: Copiar os logos**

Run: `mkdir public && cp docs/assets/logo-light-bg.png public/ && cp docs/assets/logo-dark-bg.png public/`
Expected: `ls public` lista os dois arquivos.

- [ ] **Step 5: Aplicar CSS e fonte no layout raiz**

Replace `src/app/layout.tsx` entirely:

```tsx
import { Outfit } from "next/font/google";
import "./globals.css";

const outfit = Outfit({ subsets: ["latin"], variable: "--font-outfit" });

export const metadata = { title: "Market77" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={outfit.variable}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
```

- [ ] **Step 6: Verificar**

Run: `npm run typecheck && npm run build`
Expected: sem erros; o build lista as rotas existentes. (O build baixa a fonte do Google: sem rede ele falha em `next/font`; nesse caso rode na rede e registre.)

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json postcss.config.mjs src/app/globals.css src/app/layout.tsx public
git commit -m "feat: add Tailwind with orange brand tokens, Outfit font and logos"
```

---

### Task 2: Componentes base (`src/ui/`)

**Files:**
- Create: `src/ui/cx.ts`, `Button.tsx`, `Card.tsx`, `Field.tsx`, `Badge.tsx`, `Alert.tsx`, `PageHeader.tsx`, `Table.tsx`, `Logo.tsx`, `AuthShell.tsx`, `tones.ts`, `index.ts` (todos em `src/ui/`)
- Modify: `vitest.config.ts`
- Test: `tests/ui/components.test.tsx`

**Interfaces:**
- Produces (todos reexportados por `@/ui`):
  - `cx(...parts: (string | false | null | undefined)[]): string`
  - `Button(props: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost"; size?: "md" | "touch" })`
  - `Card(props: { title?: ReactNode; className?: string; children: ReactNode })`
  - `Field(props: { label: ReactNode; className?: string; children: ReactNode })`, `Input(props: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean; touch?: boolean })`, `Select(props: SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean })`, `Checkbox(props: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode })`
  - `type Tone = "neutral" | "success" | "warning" | "danger" | "brand"`, `Badge(props: { tone?: Tone; className?: string; children: ReactNode })`
  - `Alert(props: HTMLAttributes<HTMLDivElement> & { tone?: "info" | "success" | "warning" | "danger" })`
  - `PageHeader(props: { title: ReactNode; description?: ReactNode; actions?: ReactNode })`
  - `Table(props: { children: ReactNode; className?: string })` (recebe `<thead>` e `<tbody>`)
  - `Logo(props: { className?: string })`
  - `AuthShell(props: { title: string; children: ReactNode })`
  - de `tones.ts`: `SALE_TONE`, `PAYMENT_TONE`, `FISCAL_TONE`, `COMMAND_TONE`: `Record<string, Tone>` com as mesmas chaves de `STATUS_LABEL`, `PAYMENT_LABEL`, `FISCAL_LABEL`, `COMMAND_STATUS_LABEL` (`src/lib/labels.ts`).

- [ ] **Step 1: Habilitar JSX nos testes**

O `tsconfig.json` usa `"jsx": "preserve"`, que o esbuild do vitest não transforma. Em `vitest.config.ts`, dentro de `defineConfig({`, logo antes de `test: {`, acrescentar:

```ts
  esbuild: { jsx: "automatic" },
```

- [ ] **Step 2: Escrever o teste que falha**

Create `tests/ui/components.test.tsx`:

```tsx
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { COMMAND_STATUS_LABEL, FISCAL_LABEL, PAYMENT_LABEL, STATUS_LABEL } from "@/lib/labels";
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  COMMAND_TONE,
  FISCAL_TONE,
  Field,
  Input,
  Logo,
  PAYMENT_TONE,
  PageHeader,
  SALE_TONE,
  Select,
  Table,
} from "@/ui";

const html = (el: React.ReactElement) => renderToString(el);

describe("Button", () => {
  it("is primary and medium by default", () => {
    const out = html(<Button>Salvar</Button>);
    expect(out).toContain("bg-brand-700");
    expect(out).toContain("h-9");
    expect(out).toContain("Salvar");
  });
  it("applies variant and size", () => {
    expect(html(<Button variant="secondary">x</Button>)).toContain("border-border");
    expect(html(<Button variant="ghost">x</Button>)).toContain("hover:bg-subtle");
    expect(html(<Button size="touch">x</Button>)).toContain("min-h-16");
    expect(html(<Button size="touch">x</Button>)).toContain("text-2xl");
  });
  it("forwards native attributes", () => {
    const out = html(<Button type="submit" disabled>x</Button>);
    expect(out).toContain('type="submit"');
    expect(out).toContain("disabled");
    expect(out).toContain("disabled:opacity-50");
  });
});

describe("Badge", () => {
  it.each(["neutral", "success", "warning", "danger", "brand"] as const)("%s has a dark mode class", (tone) => {
    const out = html(<Badge tone={tone}>x</Badge>);
    expect(out).toContain("dark:bg-");
    expect(out).toContain("dark:text-");
  });
  it("danger is red", () => {
    expect(html(<Badge tone="danger">x</Badge>)).toContain("bg-red-100");
  });
});

describe("Alert", () => {
  it("warns and errors with role alert", () => {
    expect(html(<Alert tone="danger">x</Alert>)).toContain('role="alert"');
    expect(html(<Alert tone="warning">x</Alert>)).toContain('role="alert"');
  });
  it("informs and confirms with role status", () => {
    expect(html(<Alert>x</Alert>)).toContain('role="status"');
    expect(html(<Alert tone="success">x</Alert>)).toContain('role="status"');
  });
  it("lets the caller override the role", () => {
    expect(html(<Alert tone="danger" role="status">x</Alert>)).toContain('role="status"');
  });
});

describe("Card", () => {
  it("renders a heading only with a title", () => {
    expect(html(<Card title="Novo">corpo</Card>)).toContain("<h2");
    expect(html(<Card>corpo</Card>)).not.toContain("<h2");
  });
});

describe("Field", () => {
  it("wraps the control in a label with the text", () => {
    const out = html(<Field label="Nome"><Input name="name" /></Field>);
    expect(out).toContain("<label");
    expect(out).toContain("Nome");
    expect(out).toContain('name="name"');
  });
  it("marks invalid and touch inputs", () => {
    expect(html(<Input invalid />)).toContain("border-red-600");
    expect(html(<Input touch />)).toContain("h-16");
    expect(html(<Select invalid><option>a</option></Select>)).toContain("border-red-600");
  });
  it("checkbox keeps its label", () => {
    const out = html(<Checkbox name="active" label="Ativo" />);
    expect(out).toContain('type="checkbox"');
    expect(out).toContain("Ativo");
  });
});

describe("Table", () => {
  it("scrolls horizontally instead of overflowing the page", () => {
    const out = html(<Table><tbody><tr><td>x</td></tr></tbody></Table>);
    expect(out).toContain("overflow-x-auto");
    expect(out).toContain("<table");
  });
});

describe("PageHeader", () => {
  it("renders title, description and actions", () => {
    const out = html(<PageHeader title="Produtos" description="Catálogo" actions={<button>Novo</button>} />);
    expect(out).toContain("<h1");
    expect(out).toContain("Produtos");
    expect(out).toContain("Catálogo");
    expect(out).toContain("Novo");
  });
});

describe("Logo", () => {
  it("switches image by color scheme", () => {
    const out = html(<Logo />);
    expect(out).toContain("/logo-light-bg.png");
    expect(out).toContain("/logo-dark-bg.png");
    expect(out).toContain("prefers-color-scheme: dark");
    expect(out).toContain('alt="Market77"');
  });
});

describe("tones", () => {
  it.each([
    [SALE_TONE, STATUS_LABEL],
    [PAYMENT_TONE, PAYMENT_LABEL],
    [FISCAL_TONE, FISCAL_LABEL],
    [COMMAND_TONE, COMMAND_STATUS_LABEL],
  ])("has a tone for every label key", (tones, labels) => {
    for (const key of Object.keys(labels)) expect(tones[key], key).toBeDefined();
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest run tests/ui/components.test.tsx`
Expected: FAIL (`Failed to resolve import "@/ui"`).

- [ ] **Step 4: Criar os componentes**

`src/ui/cx.ts`:

```ts
export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");
```

`src/ui/Button.tsx`:

```tsx
import type { ButtonHTMLAttributes } from "react";
import { cx } from "./cx";

const base =
  "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600";
const variants = {
  primary: "bg-brand-700 text-white hover:bg-brand-800",
  secondary: "border border-border bg-surface text-fg hover:bg-subtle",
  ghost: "text-fg hover:bg-subtle",
};
const sizes = {
  md: "h-9 px-3.5 text-sm",
  touch: "min-h-16 rounded-xl px-8 text-2xl",
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof variants; size?: keyof typeof sizes }) {
  return <button className={cx(base, variants[variant], sizes[size], className)} {...rest} />;
}
```

`src/ui/Card.tsx`:

```tsx
import type { ReactNode } from "react";
import { cx } from "./cx";

export function Card({ title, className, children }: { title?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={cx("rounded-xl border border-border bg-surface shadow-sm", className)}>
      {title && <h2 className="border-b border-border px-5 py-3.5 text-base font-semibold">{title}</h2>}
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}
```

`src/ui/Field.tsx`:

```tsx
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { cx } from "./cx";

const control =
  "rounded-md border bg-surface text-fg placeholder:text-muted focus:outline-2 focus:outline-brand-600";

export function Field({ label, className, children }: { label: ReactNode; className?: string; children: ReactNode }) {
  return (
    <label className={cx("block space-y-1.5 [&>input]:w-full [&>select]:w-full", className)}>
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}

export function Input({
  invalid,
  touch,
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean; touch?: boolean }) {
  return (
    <input
      className={cx(
        control,
        touch ? "h-16 rounded-xl px-5 text-2xl" : "h-9 px-3 text-sm",
        invalid ? "border-red-600" : "border-border",
        className,
      )}
      {...rest}
    />
  );
}

export function Select({
  invalid,
  className,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return (
    <select
      className={cx(control, "h-9 px-2.5 text-sm", invalid ? "border-red-600" : "border-border", className)}
      {...rest}
    />
  );
}

export function Checkbox({ label, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label className={cx("flex items-center gap-2 text-sm font-medium", className)}>
      <input type="checkbox" className="size-4 accent-brand-600" {...rest} />
      {label}
    </label>
  );
}
```

`src/ui/Badge.tsx`:

```tsx
import type { ReactNode } from "react";
import { cx } from "./cx";

export type Tone = "neutral" | "success" | "warning" | "danger" | "brand";

const tones: Record<Tone, string> = {
  neutral: "bg-subtle text-muted ring-border dark:bg-subtle dark:text-muted",
  success: "bg-green-100 text-green-800 ring-green-200 dark:bg-green-950 dark:text-green-300 dark:ring-green-900",
  warning: "bg-amber-100 text-amber-900 ring-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-900",
  danger: "bg-red-100 text-red-800 ring-red-200 dark:bg-red-950 dark:text-red-300 dark:ring-red-900",
  brand: "bg-brand-100 text-brand-800 ring-brand-200 dark:bg-brand-950 dark:text-brand-200 dark:ring-brand-900",
};

export function Badge({ tone = "neutral", className, children }: { tone?: Tone; className?: string; children: ReactNode }) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
```

`src/ui/Alert.tsx`:

```tsx
import type { HTMLAttributes } from "react";
import { cx } from "./cx";

const tones = {
  info: "border-sky-600 bg-sky-50 text-sky-900 dark:bg-sky-950 dark:text-sky-100",
  success: "border-green-600 bg-green-50 text-green-900 dark:bg-green-950 dark:text-green-100",
  warning: "border-amber-500 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100",
  danger: "border-red-600 bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-100",
};

export function Alert({
  tone = "info",
  className,
  role,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { tone?: keyof typeof tones }) {
  const implied = tone === "danger" || tone === "warning" ? "alert" : "status";
  return <div role={role ?? implied} className={cx("rounded-lg border-l-4 px-4 py-3", tones[tone], className)} {...rest} />;
}
```

`src/ui/PageHeader.tsx`:

```tsx
import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-muted">{description}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </header>
  );
}
```

`src/ui/Table.tsx`:

```tsx
import type { ReactNode } from "react";
import { cx } from "./cx";

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx("overflow-x-auto rounded-xl border border-border bg-surface shadow-sm", className)}>
      <table className="w-full text-sm [&_td]:border-t [&_td]:border-border [&_td]:px-4 [&_td]:py-3 [&_td]:align-top [&_th]:bg-subtle [&_th]:px-4 [&_th]:py-2.5 [&_th]:text-left [&_th]:font-medium [&_th]:text-muted">
        {children}
      </table>
    </div>
  );
}
```

`src/ui/Logo.tsx`:

```tsx
export function Logo({ className }: { className?: string }) {
  return (
    <picture>
      <source media="(prefers-color-scheme: dark)" srcSet="/logo-dark-bg.png" />
      <img src="/logo-light-bg.png" alt="Market77" className={className} />
    </picture>
  );
}
```

`src/ui/AuthShell.tsx`:

```tsx
import type { ReactNode } from "react";
import { Card } from "./Card";
import { Logo } from "./Logo";

export function AuthShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 px-4 py-10">
      <Logo className="h-10 w-auto" />
      <Card title={title} className="w-full max-w-sm">
        {children}
      </Card>
    </main>
  );
}
```

`src/ui/tones.ts`:

```ts
import type { Tone } from "./Badge";

export const SALE_TONE: Record<string, Tone> = {
  open: "neutral",
  awaiting_payment: "warning",
  paid: "success",
  cancelled: "neutral",
  expired: "neutral",
};

export const PAYMENT_TONE: Record<string, Tone> = {
  pending: "warning",
  confirmed: "success",
  expired: "neutral",
  failed: "danger",
};

export const FISCAL_TONE: Record<string, Tone> = {
  pending: "warning",
  issued: "success",
  error: "danger",
};

export const COMMAND_TONE: Record<string, Tone> = {
  pending: "neutral",
  delivered: "brand",
  succeeded: "success",
  failed: "danger",
};
```

`src/ui/index.ts` (Sidebar entra na Task 3):

```ts
export { Alert } from "./Alert";
export { AuthShell } from "./AuthShell";
export { Badge, type Tone } from "./Badge";
export { Button } from "./Button";
export { Card } from "./Card";
export { cx } from "./cx";
export { Checkbox, Field, Input, Select } from "./Field";
export { Logo } from "./Logo";
export { PageHeader } from "./PageHeader";
export { Table } from "./Table";
export { COMMAND_TONE, FISCAL_TONE, PAYMENT_TONE, SALE_TONE } from "./tones";
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run tests/ui/components.test.tsx`
Expected: PASS.

- [ ] **Step 6: Suíte completa e tipos**

Run: `npm run typecheck && npm test`
Expected: sem erros; todos os testes (os 665 antigos mais os novos) passam.

- [ ] **Step 7: Commit**

```bash
git add src/ui tests/ui vitest.config.ts
git commit -m "feat: base UI components with Tailwind variants"
```

---

### Task 3: Sidebar e página de referência `/ui`

**Files:**
- Create: `src/ui/Sidebar.tsx`, `src/app/ui/page.tsx`
- Modify: `src/ui/index.ts`
- Test: `tests/ui/reference-page.test.tsx`

**Interfaces:**
- Consumes: componentes da Task 2.
- Produces: `type NavItem = { href: string; label: string; exact?: boolean }` e `Sidebar(props: { items: NavItem[]; footer?: ReactNode })` (client component), ambos reexportados por `@/ui`. Rota `/ui`.

- [ ] **Step 1: Escrever o teste que falha**

Create `tests/ui/reference-page.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from "vitest";
import UiPage from "@/app/ui/page";

afterEach(() => vi.unstubAllEnvs());

describe("/ui reference page", () => {
  it("renders outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(() => UiPage()).not.toThrow();
  });
  it("answers 404 in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => UiPage()).toThrow();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/ui/reference-page.test.tsx`
Expected: FAIL (`Failed to resolve import "@/app/ui/page"`).

- [ ] **Step 3: Criar a Sidebar**

`src/ui/Sidebar.tsx`:

```tsx
"use client";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { cx } from "./cx";
import { Logo } from "./Logo";

export type NavItem = { href: string; label: string; exact?: boolean };

export function Sidebar({ items, footer }: { items: NavItem[]; footer?: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);
  return (
    <>
      <div className="flex items-center justify-between border-b border-border bg-surface px-4 py-3 md:hidden">
        <Logo className="h-6 w-auto" />
        <button
          type="button"
          aria-expanded={open}
          aria-controls="sidebar-nav"
          onClick={() => setOpen((o) => !o)}
          className="rounded-md border border-border px-3 py-1.5 text-sm font-medium"
        >
          Menu
        </button>
      </div>
      <aside
        id="sidebar-nav"
        className={cx(
          "border-b border-border bg-surface md:sticky md:top-0 md:block md:h-screen md:w-60 md:shrink-0 md:overflow-y-auto md:border-r md:border-b-0",
          open ? "block" : "hidden",
        )}
      >
        <div className="hidden px-5 py-6 md:block">
          <Logo className="h-7 w-auto" />
        </div>
        <nav aria-label="Principal" className="flex flex-col gap-1 px-3 py-3 md:py-0">
          {items.map((item) => {
            const active = item.exact
              ? pathname === item.href
              : pathname === item.href || pathname?.startsWith(`${item.href}/`);
            return (
              <a
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "rounded-md px-3 py-2 text-sm font-medium",
                  active
                    ? "bg-brand-50 text-brand-800 dark:bg-brand-950 dark:text-brand-200"
                    : "text-muted hover:bg-subtle hover:text-fg",
                )}
              >
                {item.label}
              </a>
            );
          })}
        </nav>
        {footer && <div className="px-3 py-4">{footer}</div>}
      </aside>
    </>
  );
}
```

Em `src/ui/index.ts`, acrescentar a linha (mantendo a ordem alfabética):

```ts
export { type NavItem, Sidebar } from "./Sidebar";
```

- [ ] **Step 4: Criar a página de referência**

`src/app/ui/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Field,
  Input,
  Logo,
  PageHeader,
  Select,
  Table,
  type Tone,
} from "@/ui";

const tones: Tone[] = ["neutral", "success", "warning", "danger", "brand"];

export default function UiReferencePage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <main className="mx-auto max-w-4xl space-y-8 px-4 py-10">
      <Logo className="h-10 w-auto" />
      <PageHeader title="Componentes" description="Referência visual. Só existe fora de produção." actions={<Button>Ação</Button>} />
      <Card title="Botões">
        <div className="flex flex-wrap items-center gap-3">
          <Button>Primário</Button>
          <Button variant="secondary">Secundário</Button>
          <Button variant="ghost">Fantasma</Button>
          <Button disabled>Desativado</Button>
          <Button size="touch">Toque</Button>
        </div>
      </Card>
      <Card title="Campos">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome"><Input placeholder="Nome" /></Field>
          <Field label="Com erro"><Input invalid defaultValue="valor" /></Field>
          <Field label="Seleção"><Select><option>Um</option><option>Dois</option></Select></Field>
          <Checkbox label="Ativo" defaultChecked />
        </div>
      </Card>
      <Card title="Badges">
        <div className="flex flex-wrap gap-2">
          {tones.map((t) => (
            <Badge key={t} tone={t}>{t}</Badge>
          ))}
        </div>
      </Card>
      <div className="space-y-3">
        <Alert tone="info">Informação</Alert>
        <Alert tone="success">Sucesso</Alert>
        <Alert tone="warning">Aviso</Alert>
        <Alert tone="danger">Erro</Alert>
      </div>
      <Table>
        <thead>
          <tr><th>Produto</th><th>Preço</th><th>Situação</th></tr>
        </thead>
        <tbody>
          <tr><td>Água 500 ml</td><td>R$ 3,50</td><td><Badge tone="success">Ativo</Badge></td></tr>
          <tr><td>Biscoito</td><td>R$ 5,90</td><td><Badge tone="warning">Estoque baixo</Badge></td></tr>
        </tbody>
      </Table>
    </main>
  );
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run tests/ui && npm run typecheck`
Expected: PASS, sem erros de tipo.

- [ ] **Step 6: Verificação visual e build**

Run: `npm run build`
Expected: sem erros; `/ui` aparece como rota.
Depois: `npm run dev` e abrir `http://localhost:3000/ui` no Chrome. Conferir: cores laranja, texto legível, claro e escuro (alternar a aparência do macOS ou DevTools, Rendering, Emulate prefers-color-scheme), largura de celular (390 px).

- [ ] **Step 7: Commit**

```bash
git add src/ui src/app/ui tests/ui
git commit -m "feat: sidebar and dev-only component reference page"
```

---

### Task 4: Layout do painel, painel, mercados, produtos e equipe

**Files:**
- Modify: `src/app/o/[orgId]/layout.tsx`, `src/app/o/[orgId]/page.tsx`, `src/app/o/[orgId]/markets/page.tsx`, `src/app/o/[orgId]/products/page.tsx`, `src/app/o/[orgId]/team/page.tsx`

**Interfaces:**
- Consumes: `@/ui` (Task 2 e 3).

- [ ] **Step 1: Layout com sidebar**

Replace `src/app/o/[orgId]/layout.tsx` entirely:

```tsx
import { requireOrgPage } from "@/auth/guard";
import { can } from "@/auth/permissions";
import { Button, type NavItem, Sidebar } from "@/ui";
import { logoutAction } from "./actions";

export default async function OrgLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  const { role } = await requireOrgPage(orgId);
  const base = `/o/${orgId}`;
  const items: NavItem[] = [
    { href: base, label: "Painel", exact: true },
    { href: `${base}/markets`, label: "Mercados" },
    { href: `${base}/products`, label: "Produtos" },
    ...(can(role, "sale:read") ? [{ href: `${base}/sales`, label: "Vendas" }] : []),
    ...(can(role, "terminal:write") ? [{ href: `${base}/terminals`, label: "Totens" }] : []),
    ...(can(role, "payment:write") ? [{ href: `${base}/settings/payments`, label: "Pagamentos" }] : []),
    ...(can(role, "member:write") ? [{ href: `${base}/team`, label: "Equipe" }] : []),
  ];
  return (
    <div className="min-h-screen md:flex">
      <Sidebar
        items={items}
        footer={
          <form action={logoutAction}>
            <Button type="submit" variant="ghost" className="w-full justify-start">
              Sair
            </Button>
          </form>
        }
      />
      <div className="min-w-0 flex-1">
        <div className="mx-auto max-w-6xl px-4 py-6 md:px-10 md:py-10">{children}</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Painel (dashboard)**

In `src/app/o/[orgId]/page.tsx`, add `import { Alert, Badge, Card, PageHeader } from "@/ui";` after the `formatBRL` import, and replace the whole `return (...)` block (from `  return (` to the closing `  );` of the component) with:

```tsx
  return (
    <main className="space-y-6">
      <PageHeader title="Painel" />
      {offline !== null && offline > 0 && (
        <Alert tone="warning">
          <a href={`/o/${orgId}/terminals`} className="font-semibold underline">
            {offline} totem(ns) offline
          </a>
        </Alert>
      )}
      {fiscalErrors !== null && fiscalErrors > 0 && (
        <Alert tone="danger">
          <a href={`/o/${orgId}/sales`} className="font-semibold underline">
            {fiscalErrors} nota(s) com erro
          </a>
        </Alert>
      )}
      {today && (
        <Card>
          <p className="text-sm font-medium text-muted">Vendas hoje</p>
          <p className="mt-1 text-3xl font-semibold">{formatBRL(today.totalCents)}</p>
          <p className="text-sm text-muted">{today.count} venda(s)</p>
        </Card>
      )}
      <Card title="Mercados">
        {markets.length === 0 && <p className="text-muted">Nenhum mercado cadastrado ainda.</p>}
        <ul className="-my-4 divide-y divide-border">
          {markets.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-2 py-3">
              <a href={`/o/${orgId}/markets/${m.id}`} className="font-medium text-link hover:underline">
                {m.name}
              </a>
              {m.low.length > 0 && <Badge tone="warning">{m.low.length} produto(s) com estoque baixo</Badge>}
              {m.expired > 0 && <Badge tone="danger">{m.expired} lote(s) vencido(s)</Badge>}
            </li>
          ))}
        </ul>
      </Card>
    </main>
  );
```

- [ ] **Step 3: Mercados**

In `src/app/o/[orgId]/markets/page.tsx`, add `import { Alert, Button, Card, Field, Input, PageHeader } from "@/ui";` after the `createMarketAction` import... (keep imports sorted: put it before `./actions`), and replace the `return (...)` block with:

```tsx
  return (
    <main className="space-y-6">
      <PageHeader title="Mercados" />
      {error && <Alert tone="danger">{message(error)}</Alert>}
      <Card>
        {markets.length === 0 && <p className="text-muted">Nenhum mercado cadastrado ainda.</p>}
        <ul className="-my-4 divide-y divide-border">
          {markets.map((m) => (
            <li key={m.id} className="py-3">
              <a href={`/o/${orgId}/markets/${m.id}`} className="font-medium text-link hover:underline">
                {m.name}
              </a>{" "}
              <span className="text-muted">{m.address}</span>
            </li>
          ))}
        </ul>
      </Card>
      {can(role, "market:write") && (
        <Card title="Novo mercado">
          <form action={createMarketAction.bind(null, orgId)} className="grid gap-4 sm:grid-cols-3">
            <Field label="Nome"><Input name="name" required minLength={2} /></Field>
            <Field label="Endereço"><Input name="address" /></Field>
            <Field label="CNPJ"><Input name="cnpj" inputMode="numeric" /></Field>
            <div className="sm:col-span-3">
              <Button type="submit">Cadastrar</Button>
            </div>
          </form>
        </Card>
      )}
    </main>
  );
```

- [ ] **Step 4: Produtos**

In `src/app/o/[orgId]/products/page.tsx`, add `import { Alert, Badge, Button, Card, Field, Input, PageHeader, Table } from "@/ui";` before the `./actions` import, and replace the `return (...)` block with:

```tsx
  return (
    <main className="space-y-6">
      <PageHeader title="Produtos" />
      {error && <Alert tone="danger">{message(error)}</Alert>}
      <Table>
        <thead>
          <tr><th>Nome</th><th>Categoria</th><th>Códigos de barras</th><th>NCM</th></tr>
        </thead>
        <tbody>
          {products.map((p) => (
            <tr key={p.id}>
              <td className="font-medium">{p.name}</td>
              <td>{p.category}</td>
              <td className="break-all">{p.barcodes.join(", ")}</td>
              <td>
                {p.ncm ?? <Badge tone="warning">sem NCM</Badge>}
                {can(role, "product:write") && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-sm font-medium text-link">Dados fiscais</summary>
                    <form action={updateProductFiscalAction.bind(null, orgId, p.id)} className="mt-3 grid gap-3 sm:grid-cols-3">
                      <Field label="NCM"><Input name="ncm" inputMode="numeric" maxLength={8} defaultValue={p.ncm ?? ""} /></Field>
                      <Field label="CEST"><Input name="cest" inputMode="numeric" maxLength={7} defaultValue={p.cest ?? ""} /></Field>
                      <Field label="CFOP"><Input name="cfop" inputMode="numeric" maxLength={4} defaultValue={p.cfop} /></Field>
                      <Field label="CSOSN"><Input name="csosn" inputMode="numeric" maxLength={3} defaultValue={p.csosn} /></Field>
                      <Field label="Unidade"><Input name="unit" maxLength={6} defaultValue={p.unit} /></Field>
                      <Field label="Origem (0 a 8)"><Input name="origin" type="number" min={0} max={8} defaultValue={p.origin} /></Field>
                      <div className="sm:col-span-3">
                        <Button type="submit">Salvar</Button>
                      </div>
                    </form>
                  </details>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      {can(role, "product:write") && (
        <Card title="Novo produto">
          <form action={createProductAction.bind(null, orgId)} className="grid gap-4 sm:grid-cols-3">
            <Field label="Nome"><Input name="name" required minLength={2} /></Field>
            <Field label="Categoria"><Input name="category" /></Field>
            <Field label="Códigos de barras (separe por vírgula)"><Input name="barcodes" /></Field>
            <div className="sm:col-span-3">
              <Button type="submit">Cadastrar</Button>
            </div>
          </form>
        </Card>
      )}
    </main>
  );
```

- [ ] **Step 5: Equipe**

In `src/app/o/[orgId]/team/page.tsx`, add `import { Alert, Button, Card, Field, Input, PageHeader, Select } from "@/ui";` before the `./actions` import, and replace the `return (...)` block with:

```tsx
  return (
    <main className="space-y-6">
      <PageHeader title="Equipe" />
      {error && <Alert tone="danger">{message(error)}</Alert>}
      {ok && <Alert tone="success">Membro adicionado.</Alert>}
      <Card title="Adicionar membro">
        <form action={addMemberAction.bind(null, orgId)} className="grid gap-4 sm:grid-cols-3">
          <Field label="E-mail"><Input name="email" type="email" required /></Field>
          <Field label="Senha inicial"><Input name="password" type="password" minLength={8} required /></Field>
          <Field label="Papel">
            <Select name="role">
              <option value="manager">Gerente</option>
              <option value="restocker">Repositor</option>
            </Select>
          </Field>
          <div className="sm:col-span-3">
            <Button type="submit">Adicionar</Button>
          </div>
        </form>
      </Card>
    </main>
  );
```

- [ ] **Step 6: Verificar**

Run: `npm run typecheck && npm test`
Expected: sem erros.
Run: `grep -c "<main" "src/app/o/[orgId]/layout.tsx"`
Expected: `0` (o layout não renderiza `<main>`; cada página tem o seu).

- [ ] **Step 7: Conferência manual**

Com o app rodando (`npm run dev`, banco conforme "Início rápido" do README), criar conta em `/signup`, abrir painel, mercados, produtos e equipe. Conferir: sidebar com item ativo destacado; no celular (390 px) o menu abre e fecha e fecha ao navegar; claro e escuro. Adicionar um gerente e um repositor em Equipe, entrar com cada um e conferir que o menu só lista o que o papel permite (repositor não vê Equipe, Totens, Pagamentos).

- [ ] **Step 8: Commit**

```bash
git add "src/app/o/[orgId]/layout.tsx" "src/app/o/[orgId]/page.tsx" "src/app/o/[orgId]/markets/page.tsx" "src/app/o/[orgId]/products/page.tsx" "src/app/o/[orgId]/team/page.tsx"
git commit -m "feat: panel layout with sidebar and redesigned dashboard, markets, products and team"
```

---

### Task 5: Vendas, detalhe da venda e pagamentos

**Files:**
- Modify: `src/app/o/[orgId]/sales/page.tsx`, `src/app/o/[orgId]/sales/[saleId]/page.tsx`, `src/app/o/[orgId]/settings/payments/page.tsx`

**Interfaces:**
- Consumes: `@/ui`, incluindo `SALE_TONE`, `PAYMENT_TONE`, `FISCAL_TONE`.

- [ ] **Step 1: Lista de vendas**

In `src/app/o/[orgId]/sales/page.tsx`, add `import { Badge, Card, PageHeader, SALE_TONE, Table } from "@/ui";` after the `formatBRL` import, and replace the `return (...)` block with:

```tsx
  return (
    <main className="space-y-6">
      <PageHeader title="Vendas" />
      {sales.length === 0 && <Card><p className="text-muted">Nenhuma venda ainda.</p></Card>}
      {sales.length > 0 && (
        <Table>
          <thead>
            <tr><th>Data</th><th>Mercado</th><th>Itens</th><th>Total</th><th>Situação</th></tr>
          </thead>
          <tbody>
            {sales.map((s) => (
              <tr key={s.id}>
                <td>
                  <a href={`/o/${orgId}/sales/${s.id}`} className="font-medium text-link hover:underline">
                    {s.createdAt.toLocaleString("pt-BR", { timeZone: s.timezone })}
                  </a>
                </td>
                <td>{s.marketName}</td>
                <td>{s.itemCount}</td>
                <td>{formatBRL(s.totalCents)}</td>
                <td>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge tone={SALE_TONE[s.status] ?? "neutral"}>{STATUS_LABEL[s.status] ?? s.status}</Badge>
                    {s.needsAttention && <Badge tone="warning">requer atenção</Badge>}
                    {s.fiscalError && <Badge tone="danger">nota com erro</Badge>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </main>
  );
```

- [ ] **Step 2: Detalhe da venda**

In `src/app/o/[orgId]/sales/[saleId]/page.tsx`, add `import { Alert, Badge, Button, Card, FISCAL_TONE, PAYMENT_TONE, PageHeader, SALE_TONE } from "@/ui";` before the `./actions` import, and replace the `return (...)` block with:

```tsx
  return (
    <main className="space-y-6">
      <PageHeader
        title="Venda"
        description={`${sale.marketName}, ${when(sale.createdAt)}`}
        actions={<Badge tone={SALE_TONE[sale.status] ?? "neutral"}>{STATUS_LABEL[sale.status] ?? sale.status}</Badge>}
      />
      {error && <Alert tone="danger">{message(error)}</Alert>}
      <Card>
        <p className="text-sm font-medium text-muted">Total</p>
        <p className="mt-1 text-3xl font-semibold">{formatBRL(sale.totalCents)}</p>
        {sale.paidAt && <p className="text-sm text-muted">Paga em {when(sale.paidAt)}</p>}
        {sale.customerCpfMasked && <p className="mt-2 text-sm">CPF na nota: {sale.customerCpfMasked}</p>}
      </Card>
      <Card title="Itens">
        <ul className="-my-4 divide-y divide-border">
          {sale.items.map((i, idx) => (
            <li key={idx} className="py-3">
              {i.quantity} x {i.productName} a {formatBRL(i.unitPriceCents)}
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Pagamentos">
        {sale.payments.length === 0 && <p className="text-muted">Nenhum pagamento iniciado.</p>}
        <ul className="-my-4 divide-y divide-border">
          {sale.payments.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-2 py-3">
              <span className="font-medium">{METHOD_LABEL[p.method] ?? p.method}</span>
              <Badge tone={PAYMENT_TONE[p.status] ?? "neutral"}>{PAYMENT_LABEL[p.status] ?? p.status}</Badge>
              {p.failureReason && <Badge tone="danger">{FAILURE_LABEL[p.failureReason] ?? p.failureReason}</Badge>}
              <span className="text-muted">
                esperado {formatBRL(p.amountCents)}
                {p.paidAmountCents !== null && <>, recebido {formatBRL(p.paidAmountCents)}</>}
              </span>
              {p.status === "failed" && !p.failureReason && (
                <Badge tone="warning">requer atenção: verifique com o provedor</Badge>
              )}
            </li>
          ))}
        </ul>
      </Card>
      {sale.fiscal && (
        <Card title="Nota fiscal">
          <div className="space-y-2">
            <p className="flex flex-wrap items-center gap-2">
              <Badge tone={FISCAL_TONE[sale.fiscal.status] ?? "neutral"}>
                {FISCAL_LABEL[sale.fiscal.status] ?? sale.fiscal.status}
              </Badge>
              {sale.fiscal.number !== null && <>número {sale.fiscal.number}</>}
              {sale.fiscal.danfeUrl &&
                (sale.fiscal.danfeUrl.startsWith("https://") ? (
                  <a href={sale.fiscal.danfeUrl} className="font-medium text-link hover:underline">
                    DANFE
                  </a>
                ) : (
                  <span className="text-muted">DANFE indisponível</span>
                ))}
            </p>
            {sale.fiscal.accessKey && <p className="break-all text-sm text-muted">Chave {sale.fiscal.accessKey}</p>}
            {sale.fiscal.lastError && (
              <Alert tone={sale.fiscal.status === "error" ? "danger" : "info"}>
                Última falha: {sale.fiscal.lastError}
              </Alert>
            )}
            {sale.fiscal.status === "error" && can(role, "market:write") && (
              <form action={reissueFiscalAction.bind(null, orgId, sale.id)}>
                <Button type="submit">Reemitir</Button>
              </form>
            )}
          </div>
        </Card>
      )}
      <p>
        <a href={`/o/${orgId}/sales`} className="font-medium text-link hover:underline">
          Voltar às vendas
        </a>
      </p>
    </main>
  );
```

Nota: `Alert` aqui usa tom `info` (papel `status`) quando a nota não está com erro, e `danger` (papel `alert`) com erro; é o mesmo critério do `role` de hoje.

- [ ] **Step 3: Pagamentos (Mercado Pago)**

In `src/app/o/[orgId]/settings/payments/page.tsx`, add `import { Alert, Badge, Button, Card, Field, Input, PageHeader } from "@/ui";` before the `./actions` import, and replace the `return (...)` block with:

```tsx
  return (
    <main className="space-y-6">
      <PageHeader title="Pagamentos (Mercado Pago)" />
      {error && <Alert tone="danger">{message(error)}</Alert>}
      {ok && OK[ok] && <Alert tone="success">{OK[ok]}</Alert>}
      <Card title="Conexão">
        <p className="mb-4 flex flex-wrap items-center gap-2">
          {status.configured ? (
            <>
              <Badge tone="success">Conectado</Badge>
              <span className="text-muted">
                Token terminando em {status.last4}, atualizado em {status.updatedAt?.toLocaleString("pt-BR")}.
              </span>
            </>
          ) : (
            <>
              <Badge tone="neutral">Não conectado</Badge>
              <span className="text-muted">Os pagamentos usam o simulador.</span>
            </>
          )}
        </p>
        <form action={saveCredentialsAction.bind(null, orgId)} className="grid gap-4 sm:grid-cols-2">
          <Field label="Access token">
            <Input name="accessToken" type="password" required autoComplete="off" />
          </Field>
          <Field label="Segredo do webhook">
            <Input name="webhookSecret" type="password" required autoComplete="off" />
          </Field>
          <div className="sm:col-span-2">
            <Button type="submit">{status.configured ? "Trocar credenciais" : "Salvar credenciais"}</Button>
          </div>
        </form>
        {status.configured && (
          <div className="mt-4 flex gap-2">
            <form action={testCredentialsAction.bind(null, orgId)}>
              <Button type="submit" variant="secondary">Testar</Button>
            </form>
            <form action={removeCredentialsAction.bind(null, orgId)}>
              <Button type="submit" variant="secondary">Remover</Button>
            </form>
          </div>
        )}
      </Card>
      <Card title="URLs de webhook">
        <p className="mb-3 text-muted">
          No painel do Mercado Pago, cadastre esta URL e ative os dois tópicos nela: Pagamentos (Pix) e Orders (Mercado Pago, cartão). Copie o segredo gerado para o campo acima.
        </p>
        <code className="block break-all rounded-md bg-subtle px-3 py-2 text-sm">{`${base}/api/webhooks/mercadopago/${orgId}`}</code>
      </Card>
    </main>
  );
```

- [ ] **Step 4: Verificar**

Run: `npm run typecheck && npm test`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add "src/app/o/[orgId]/sales" "src/app/o/[orgId]/settings"
git commit -m "feat: redesigned sales list, sale detail and payment settings"
```

---

### Task 6: Totens

**Files:**
- Modify: `src/app/o/[orgId]/terminals/page.tsx`, `src/app/o/[orgId]/terminals/TerminalForm.tsx`

**Interfaces:**
- Consumes: `@/ui`, incluindo `COMMAND_TONE`.

- [ ] **Step 1: Formulário de cadastro**

Replace `src/app/o/[orgId]/terminals/TerminalForm.tsx` entirely:

```tsx
"use client";
import { useActionState } from "react";
import { Alert, Button, Card, Field, Input, Select } from "@/ui";
import { type CreateTerminalState, createTerminalAction } from "./actions";

export function TerminalForm({ orgId, markets }: { orgId: string; markets: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState<CreateTerminalState, FormData>(
    createTerminalAction.bind(null, orgId),
    {},
  );
  return (
    <Card title="Novo totem">
      <form action={formAction} className="grid gap-4 sm:grid-cols-3">
        <Field label="Nome do totem">
          <Input name="name" required minLength={2} maxLength={60} />
        </Field>
        <Field label="Mercado">
          <Select name="marketId" required>
            {markets.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="ID da maquininha Point (opcional)">
          <Input name="pointDeviceId" maxLength={64} pattern="[\x21-\x7e]+" title="Sem espaços" />
        </Field>
        <div className="sm:col-span-3">
          <Button type="submit" disabled={pending || markets.length === 0}>
            Cadastrar totem
          </Button>
        </div>
      </form>
      {state.error && (
        <Alert tone="danger" className="mt-4">
          {state.error}
        </Alert>
      )}
      {state.token && (
        <Alert tone="success" className="mt-4">
          <p>
            Totem <strong>{state.name}</strong> cadastrado. Copie o token agora: ele não será mostrado de novo.
          </p>
          <code className="mt-2 block break-all rounded-md bg-surface px-3 py-2 text-sm text-fg">{state.token}</code>
        </Alert>
      )}
    </Card>
  );
}
```

- [ ] **Step 2: Página de totens**

In `src/app/o/[orgId]/terminals/page.tsx`, add `import { Alert, Badge, Button, COMMAND_TONE, Card, Input, PageHeader, Table } from "@/ui";` before the `./TerminalForm` import, and replace the `return (...)` block (from `  return (` through the final `  );`) with:

```tsx
  return (
    <main className="space-y-6">
      <PageHeader title="Totens" />
      {error && <Alert tone="danger">{message(error)}</Alert>}
      <TerminalForm orgId={orgId} markets={markets.map((m) => ({ id: m.id, name: m.name }))} />
      {markets.length === 0 && <Alert tone="info">Cadastre um mercado antes de cadastrar um totem.</Alert>}
      <Table>
        <thead>
          <tr>
            <th>Nome</th><th>Mercado</th><th>Estado</th><th>Última batida</th><th>Agente</th><th>PDV</th><th>Point</th><th>Ações</th>
          </tr>
        </thead>
        <tbody>
          {terminals.map((t) => {
            const state = t.revokedAt
              ? "revogado"
              : t.lastHeartbeatAt === null
                ? "nunca conectou"
                : isOnline(t.lastHeartbeatAt, now)
                  ? "online"
                  : "offline";
            const send = (type: string) => sendCommandAction.bind(null, orgId, t.id, type);
            const commands = history.get(t.id) ?? [];
            return [
              <tr key={t.id}>
                <td className="font-medium">{t.name}</td>
                <td>{t.marketName}</td>
                <td>
                  <Badge tone={state === "online" ? "success" : state === "offline" ? "danger" : "neutral"}>{state}</Badge>
                </td>
                <td>{t.lastHeartbeatAt?.toLocaleString("pt-BR", { timeZone: t.timezone }) ?? "-"}</td>
                <td>{t.agentVersion ?? "-"}</td>
                <td>{t.pdvStatus === "running" ? "aberto" : t.pdvStatus === "stopped" ? "parado" : "-"}</td>
                <td>
                  {!t.revokedAt && (
                    <form action={setTerminalDeviceAction.bind(null, orgId, t.id)} className="flex gap-2">
                      <Input
                        name="pointDeviceId"
                        defaultValue={t.pointDeviceId ?? ""}
                        placeholder="sem maquininha"
                        maxLength={64}
                        pattern="[\x21-\x7e]+"
                        title="Sem espaços"
                        className="w-44"
                      />
                      <Button type="submit" variant="secondary">Salvar</Button>
                    </form>
                  )}
                </td>
                <td>
                  {!t.revokedAt && (
                    <div className="flex flex-wrap gap-2">
                      <form action={send("restart_pdv")}>
                        <Button type="submit" variant="secondary">{COMMAND_LABEL.restart_pdv}</Button>
                      </form>
                      <form action={send("reboot")}>
                        <Button type="submit" variant="secondary">{COMMAND_LABEL.reboot}</Button>
                      </form>
                      {latest && (
                        <form action={send("update")}>
                          <Button type="submit" variant="secondary" disabled={t.agentVersion === latest.version}>
                            {COMMAND_LABEL.update} para {latest.version}
                          </Button>
                        </form>
                      )}
                      <form action={revokeTerminalAction.bind(null, orgId, t.id)}>
                        <Button type="submit" variant="secondary">Revogar</Button>
                      </form>
                    </div>
                  )}
                </td>
              </tr>,
              <tr key={`${t.id}-history`}>
                <td colSpan={8} className="bg-subtle">
                  {commands.length === 0 ? (
                    <small className="text-muted">Nenhum comando enviado.</small>
                  ) : (
                    <ul className="space-y-1">
                      {commands.map((c) => (
                        <li key={c.id} className="flex flex-wrap items-center gap-2 text-xs text-muted">
                          <span>
                            {COMMAND_LABEL[c.type]} ({emails.get(c.createdBy ?? "") ?? "desconhecido"},{" "}
                            {c.createdAt.toLocaleString("pt-BR", { timeZone: t.timezone })})
                          </span>
                          <Badge tone={COMMAND_TONE[c.status] ?? "neutral"}>{COMMAND_STATUS_LABEL[c.status]}</Badge>
                          {c.error && <span>[{c.error}]</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
              </tr>,
            ];
          })}
        </tbody>
      </Table>
    </main>
  );
```

Nota: `c.id` precisa existir no tipo de `listCommands` (`src/domain/agent.ts`). Se o tipo não tiver `id`, usar `key={`${c.type}-${c.createdAt.getTime()}`}`. Conferir no typecheck.

- [ ] **Step 3: Verificar**

Run: `npm run typecheck && npm test`
Expected: sem erros. Se o typecheck acusar `c.id` ausente, aplicar a nota acima e repetir.

- [ ] **Step 4: Commit**

```bash
git add "src/app/o/[orgId]/terminals"
git commit -m "feat: redesigned terminals page and form"
```

---

### Task 7: Detalhe do mercado e acessos

**Files:**
- Modify: `src/app/o/[orgId]/markets/[marketId]/page.tsx`, `src/app/o/[orgId]/markets/[marketId]/access/page.tsx`, `src/app/o/[orgId]/markets/[marketId]/access/AccessSourceForm.tsx`

**Interfaces:**
- Consumes: `@/ui`.

- [ ] **Step 1: Formulário de leitor**

Replace `src/app/o/[orgId]/markets/[marketId]/access/AccessSourceForm.tsx` entirely:

```tsx
"use client";
import { useActionState } from "react";
import { Alert, Button, Field, Input } from "@/ui";
import { type CreateSourceState, createAccessSourceAction } from "./actions";

export function AccessSourceForm({ orgId, marketId }: { orgId: string; marketId: string }) {
  const [state, formAction, pending] = useActionState<CreateSourceState, FormData>(
    createAccessSourceAction.bind(null, orgId, marketId),
    {},
  );
  return (
    <div className="space-y-4">
      <form action={formAction} className="flex flex-wrap items-end gap-3">
        <Field label="Nome do leitor">
          <Input name="name" required minLength={2} maxLength={60} />
        </Field>
        <Button type="submit" disabled={pending}>
          Cadastrar leitor
        </Button>
      </form>
      {state.error && <Alert tone="danger">{state.error}</Alert>}
      {state.token && (
        <Alert tone="success">
          <p>
            Leitor <strong>{state.name}</strong> cadastrado. Copie o token agora: ele não será mostrado de novo.
          </p>
          <code className="mt-2 block break-all rounded-md bg-surface px-3 py-2 text-sm text-fg">{state.token}</code>
        </Alert>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Detalhe do mercado**

In `src/app/o/[orgId]/markets/[marketId]/page.tsx`, add `import { Alert, Badge, Button, Card, Checkbox, Field, Input, PageHeader, Select, Table } from "@/ui";` before the `./actions` import, and replace the `return (...)` block with:

```tsx
  return (
    <main className="space-y-6">
      <PageHeader
        title="Estoque do mercado"
        description={market?.name}
        actions={
          can(role, "access:read") && (
            <a href={`/o/${orgId}/markets/${marketId}/access`} className="text-sm font-medium text-link hover:underline">
              Acessos
            </a>
          )
        }
      />
      {error && <Alert tone="danger">{message(error)}</Alert>}
      <Table>
        <thead>
          <tr><th>Produto</th><th>Preço</th><th>Mínimo</th><th>Saldo</th><th>Ativo</th><th>Validade</th><th>Movimentar</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="font-medium">{r.name}</td>
              <td>{formatBRL(r.priceCents)}</td>
              <td>{r.minStock}</td>
              <td>
                {r.balance < 0 ? (
                  <Badge tone="danger">{r.balance} (negativo)</Badge>
                ) : r.balance <= r.minStock ? (
                  <Badge tone="warning">{r.balance} (baixo)</Badge>
                ) : (
                  r.balance
                )}
              </td>
              <td>{r.active ? "sim" : "não"}</td>
              <td>{r.tracksExpiry ? "controla" : "não"}</td>
              <td>
                {can(role, "stock:move") && (
                  <form action={moveStockAction.bind(null, orgId, marketId, r.id)} className="flex flex-wrap items-end gap-2">
                    <Select name="type" defaultValue="in">
                      <option value="in">Entrada</option>
                      <option value="sale">Venda</option>
                      <option value="loss">Perda</option>
                      <option value="adjustment">Ajuste (use sinal)</option>
                    </Select>
                    <Input name="quantity" type="number" step="1" required className="w-24" aria-label="Quantidade" />
                    {r.tracksExpiry && (
                      <>
                        <Field label="Validade (entrada)">
                          <Input name="expiresOn" type="date" />
                        </Field>
                        <Select name="lotId" defaultValue="" aria-label="Lote">
                          <option value="">Lote: o que vence primeiro</option>
                          {(lots.get(r.id) ?? []).map((l) => (
                            <option key={l.id} value={l.id}>
                              {formatDay(l.expiresOn)} ({l.balance})
                            </option>
                          ))}
                        </Select>
                      </>
                    )}
                    <Input name="note" placeholder="Observação" aria-label="Observação" />
                    <Button type="submit" variant="secondary">Registrar</Button>
                  </form>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      <Card title="Validade">
        {alerts.length === 0 ? (
          <p className="text-muted">Nenhum lote vencido ou vencendo em 7 dias.</p>
        ) : (
          <Table className="-mx-5 -my-4 rounded-none border-0 shadow-none">
            <thead>
              <tr><th>Produto</th><th>Validade</th><th>Quantidade</th><th>Situação</th></tr>
            </thead>
            <tbody>
              {alerts.map((a) => (
                <tr key={a.lotId}>
                  <td>{a.productName}</td>
                  <td>{formatDay(a.expiresOn)}</td>
                  <td>{a.quantity}</td>
                  <td>
                    {a.status === "expired" ? <Badge tone="danger">Vencido</Badge> : <Badge tone="warning">Vence em breve</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {can(role, "price:write") && (
        <Card title="Adicionar ou atualizar produto neste mercado">
          <form action={setMarketProductAction.bind(null, orgId, marketId)} className="grid gap-4 sm:grid-cols-3">
            <Field label="Produto">
              <Select name="productId" required>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>
            <Field label="Preço (R$)"><Input name="price" required inputMode="decimal" placeholder="5,90" /></Field>
            <Field label="Estoque mínimo"><Input name="minStock" type="number" min={0} defaultValue={0} /></Field>
            <Field label="Controla validade">
              <Select name="tracksExpiry" defaultValue="">
                <option value="">Manter</option>
                <option value="on">Ligar</option>
                <option value="off">Desligar</option>
              </Select>
            </Field>
            <div className="flex items-end">
              <Checkbox name="active" label="Ativo" defaultChecked />
            </div>
            <div className="sm:col-span-3">
              <Button type="submit">Salvar</Button>
            </div>
          </form>
        </Card>
      )}
      {market && can(role, "market:write") && (
        <Card title="Dados fiscais (NFC-e)">
          <form action={updateMarketFiscalAction.bind(null, orgId, marketId)} className="grid gap-4 sm:grid-cols-3">
            <div className="flex items-end sm:col-span-3">
              <Checkbox name="nfceEnabled" label="Emitir NFC-e" defaultChecked={market.nfceEnabled} />
            </div>
            <Field label="CNPJ"><Input name="cnpj" inputMode="numeric" defaultValue={market.cnpj ?? ""} /></Field>
            <Field label="Inscrição estadual"><Input name="stateRegistration" defaultValue={market.stateRegistration ?? ""} /></Field>
            <Field label="UF">
              <Select name="uf" defaultValue={market.uf ?? ""}>
                <option value="">Escolha</option>
                {UFS.map((u) => <option key={u} value={u}>{u}</option>)}
              </Select>
            </Field>
            <Field label="Regime">
              <Select name="taxRegime" defaultValue={market.taxRegime}>
                <option value="simples">Simples Nacional</option>
                <option value="normal">Regime normal (ainda não emite)</option>
              </Select>
            </Field>
            <Field label="Série"><Input name="nfceSeries" type="number" min={1} max={999} defaultValue={market.nfceSeries} /></Field>
            <div className="sm:col-span-3">
              <Button type="submit">Salvar dados fiscais</Button>
            </div>
          </form>
        </Card>
      )}
    </main>
  );
```

- [ ] **Step 3: Acessos**

In `src/app/o/[orgId]/markets/[marketId]/access/page.tsx`, add `import { Alert, Badge, Button, Card, PageHeader, Table } from "@/ui";` before the `./AccessSourceForm` import, and replace the `return (...)` block (from `  return (` through the final `  );`) with:

```tsx
  return (
    <main className="space-y-6">
      <PageHeader title={`Acessos: ${market.name}`} />
      {(error || dayError) && <Alert tone="danger">{message(error ?? dayError ?? "")}</Alert>}

      <Card title="Resumo por dia">
        <Table className="-mx-5 -my-4 rounded-none border-0 shadow-none">
          <thead>
            <tr><th>Dia</th><th>Entradas</th><th>Pessoas</th><th>Vendas pagas</th><th>Vendas por entrada</th></tr>
          </thead>
          <tbody>
            {summary.map((r) => (
              <tr key={r.day}>
                <td><a href={`?day=${r.day}`} className="font-medium text-link hover:underline">{formatDay(r.day)}</a></td>
                <td>{r.entries}</td>
                <td>{r.people}</td>
                <td>{r.paidSales}</td>
                <td>{ratio(r.salesPerEntry)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      {chosen && !dayError && (
        <Card title={`Entradas por hora em ${formatDay(chosen)}`}>
          {hourly.every((h) => h.entries === 0) ? (
            <p className="text-muted">Nenhuma entrada neste dia.</p>
          ) : (
            <Table className="-mx-5 -my-4 rounded-none border-0 shadow-none">
              <thead>
                <tr><th>Hora</th><th>Entradas</th></tr>
              </thead>
              <tbody>
                {hourly.filter((h) => h.entries > 0).map((h) => (
                  <tr key={h.hour}><td>{String(h.hour).padStart(2, "0")}h</td><td>{h.entries}</td></tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}

      <Card title="Acessos recentes">
        {recent.length === 0 && <p className="text-muted">Nenhum acesso registrado ainda.</p>}
        <ul className="-my-4 divide-y divide-border">
          {recent.map((e) => (
            <li key={e.id} className="py-3">
              <span className="text-muted">{when(e.occurredAt)}, {e.sourceName}:</span> {personLabel(e)}
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Pessoas">
        {people.length === 0 && <p className="text-muted">Nenhuma pessoa sincronizada ainda.</p>}
        <ul className="-my-4 divide-y divide-border">
          {people.map((p) => (
            <li key={p.id} className="py-3">
              {p.forgotten ? "Removida a pedido" : p.name}{" "}
              <span className="text-muted">
                (id {p.externalId}, {p.sourceName}
                {!p.active && !p.forgotten ? ", inativa" : ""})
              </span>
              {canWrite && !p.forgotten && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-sm font-medium text-link">Esquecer pessoa</summary>
                  <p className="mt-2 text-sm text-muted">Apaga o nome e o identificador dos acessos antigos. Não pode ser desfeito.</p>
                  <form action={forgetAccessPersonAction.bind(null, orgId, marketId, p.id)} className="mt-2">
                    <Button type="submit" variant="secondary">Confirmar</Button>
                  </form>
                </details>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Leitores">
        <div className="space-y-4">
          {canWrite && <AccessSourceForm orgId={orgId} marketId={marketId} />}
          {sources.length === 0 && <p className="text-muted">Nenhum leitor cadastrado.</p>}
          <ul className="divide-y divide-border">
            {sources.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2 py-3">
                <strong>{s.name}</strong>
                {s.revokedAt && <Badge tone="neutral">revogado</Badge>}
                <span className="text-muted">
                  {s.activePeople} pessoa(s) ativa(s), última sincronização {s.lastSyncAt ? when(s.lastSyncAt) : "nunca"},
                  último evento {s.lastEventAt ? when(s.lastEventAt) : "nunca"}
                </span>
                {s.lastSyncError && <Badge tone="danger">erro na sincronização: {s.lastSyncError}</Badge>}
                {canWrite && !s.revokedAt && (
                  <form action={revokeAccessSourceAction.bind(null, orgId, marketId, s.id)}>
                    <Button type="submit" variant="secondary">Revogar</Button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </div>
      </Card>
      <p>
        <a href={`/o/${orgId}/markets/${marketId}`} className="font-medium text-link hover:underline">
          Voltar ao mercado
        </a>
      </p>
    </main>
  );
```

- [ ] **Step 4: Verificar**

Run: `npm run typecheck && npm test && npm run build`
Expected: sem erros.

- [ ] **Step 5: Conferência manual do painel inteiro**

Com `npm run dev`: percorrer Painel, Mercados, detalhe do mercado (cadastrar produto no mercado, registrar entrada, produto com validade), Produtos, Vendas e detalhe (use o simulador de Pix do README para gerar uma venda), Totens (cadastrar um totem e copiar o token), Pagamentos, Equipe, Acessos. Conferir em claro e escuro, em 1280 px e 390 px: nenhum texto ilegível, nenhuma rolagem horizontal da página (só dentro das tabelas), formulários continuam enviando.

- [ ] **Step 6: Commit**

```bash
git add "src/app/o/[orgId]/markets"
git commit -m "feat: redesigned market stock and access pages"
```

---

### Task 8: Login e cadastro

**Files:**
- Modify: `src/app/login/page.tsx`, `src/app/signup/page.tsx`, `docs/superpowers/specs/2026-10-05-design-system-design.md`

**Interfaces:**
- Consumes: `AuthShell`, `Alert`, `Field`, `Input`, `Button` de `@/ui`.

- [ ] **Step 1: Login**

Replace `src/app/login/page.tsx` entirely:

```tsx
import { message } from "@/lib/messages";
import { Alert, AuthShell, Button, Field, Input } from "@/ui";
import { loginAction } from "./actions";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <AuthShell title="Entrar">
      <div className="space-y-4">
        {error && <Alert tone="danger">{message(error)}</Alert>}
        <form action={loginAction} className="space-y-4">
          <Field label="E-mail"><Input name="email" type="email" required /></Field>
          <Field label="Senha"><Input name="password" type="password" required /></Field>
          <Button type="submit" className="w-full">Entrar</Button>
        </form>
        <a href="/signup" className="block text-center text-sm font-medium text-link hover:underline">
          Criar conta
        </a>
      </div>
    </AuthShell>
  );
}
```

- [ ] **Step 2: Cadastro**

Replace `src/app/signup/page.tsx` entirely:

```tsx
import { message } from "@/lib/messages";
import { Alert, AuthShell, Button, Field, Input } from "@/ui";
import { signUpAction } from "./actions";

export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <AuthShell title="Criar conta">
      <div className="space-y-4">
        {error && <Alert tone="danger">{message(error)}</Alert>}
        <form action={signUpAction} className="space-y-4">
          <Field label="Nome da empresa"><Input name="orgName" required minLength={2} /></Field>
          <Field label="E-mail"><Input name="email" type="email" required /></Field>
          <Field label="Senha (mínimo 8 caracteres)"><Input name="password" type="password" required minLength={8} /></Field>
          <Button type="submit" className="w-full">Criar conta</Button>
        </form>
        <a href="/login" className="block text-center text-sm font-medium text-link hover:underline">
          Já tenho conta
        </a>
      </div>
    </AuthShell>
  );
}
```

- [ ] **Step 3: Corrigir o spec sobre a home**

A home (`src/app/page.tsx`) só redireciona (para `/login` ou para o primeiro painel) e não renderiza nada, então não tem visual a migrar. No spec `docs/superpowers/specs/2026-10-05-design-system-design.md`, seção 6, substituir a linha:

```
- Home (`src/app/page.tsx`): redireciona ou aponta para login como hoje, com o mesmo visual.
```

por:

```
- Home (`src/app/page.tsx`): só redireciona (login ou primeiro painel) e não renderiza nada; não muda.
```

E, na seção 1, o critério de sucesso fala em "home": trocar `painel, PDV, login, signup e home usam` por `painel, PDV, login e signup usam`.

- [ ] **Step 4: Verificar**

Run: `npm run typecheck && npm test`
Expected: sem erros. Abrir `/login` e `/signup` (sem sessão) no Chrome: card centralizado com logo, claro e escuro, 390 px; enviar com credencial errada e ver o `Alert` de erro.

- [ ] **Step 5: Commit**

```bash
git add src/app/login src/app/signup docs/superpowers/specs/2026-10-05-design-system-design.md
git commit -m "feat: redesigned login and signup, correct home note in spec"
```

---

### Task 9: PDV do totem

**Files:**
- Modify: `src/app/pdv/PdvApp.tsx`

**Interfaces:**
- Consumes: `Alert`, `Button`, `Input`, `Logo` de `@/ui`. Lógica, estados, `createScanner`, polling e chamadas à API ficam intactos; só imports, os estilos inline e o JSX final mudam.

- [ ] **Step 1: Imports**

Em `src/app/pdv/PdvApp.tsx`, trocar a linha

```tsx
import { type CSSProperties, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
```

por

```tsx
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
```

e, depois do import de `tokenFromHash`, acrescentar:

```tsx
import { Alert, Button, Input, Logo } from "@/ui";
```

- [ ] **Step 2: Remover os estilos inline e refazer `Screen`**

Substituir o bloco que vai de `const page = {` até o fim da função `Screen` (inclusive as constantes `keyButton` e `bigButton`) por:

```tsx
function Screen({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <main className="flex min-h-screen select-none flex-col items-center justify-center gap-5 p-6 text-center text-3xl">
      <h1 className="text-5xl font-semibold tracking-tight">{title}</h1>
      {children}
    </main>
  );
}
```

- [ ] **Step 3: Refazer as telas**

Substituir tudo a partir de `if (token === undefined) return null;` até o fim do arquivo por:

```tsx
  if (token === undefined) return null;
  if (!token) {
    return (
      <Screen title="Configurar totem">
        <p>Cole o token do totem (gerado no painel, em Totens).</p>
        <Input
          touch
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="w-full max-w-xl"
          aria-label="Token do totem"
        />
        <Button size="touch" onClick={connect} disabled={!draft.trim()}>
          Conectar
        </Button>
        {notice && <Alert tone="danger" className="text-xl">{notice}</Alert>}
      </Screen>
    );
  }
  if (revoked) return <Screen title="Totem desativado">Procure o responsável pela loja.</Screen>;
  if (offline) return <Screen title="Totem indisponível">Sem conexão. Tentando novamente...</Screen>;

  if (!sale) {
    return (
      <Screen title="Bem-vindo">
        <Logo className="h-16 w-auto" />
        <p className="text-muted">Escaneie um produto para começar.</p>
        {notice && <Alert tone="warning" className="text-xl">{notice}</Alert>}
      </Screen>
    );
  }
  if (sale.status === "paid") {
    return (
      <Screen title="Obrigado!">
        <p>Pagamento confirmado.</p>
      </Screen>
    );
  }
  if (sale.status === "awaiting_payment" && sale.payment?.method === "card") {
    const left = Math.max(0, Math.round((new Date(sale.payment.expiresAt).getTime() - now) / 1000));
    return (
      <Screen title={`Pague ${formatBRL(sale.totalCents)} no cartão`}>
        <p>Siga as instruções na maquininha.</p>
        <p className="text-muted">
          Tempo restante: {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
        </p>
        {notice && <Alert tone="warning" className="text-xl">{notice}</Alert>}
        <Button size="touch" variant="secondary" onClick={cancelCardPayment} disabled={cancelling}>
          Cancelar
        </Button>
      </Screen>
    );
  }
  if (sale.status === "awaiting_payment") {
    const left = Math.max(0, Math.round((new Date(sale.payment?.expiresAt ?? 0).getTime() - now) / 1000));
    return (
      <Screen title={`Pague ${formatBRL(sale.totalCents)} com Pix`}>
        {qr && <img src={qr} alt="QR code do Pix" width={320} height={320} className="rounded-xl bg-white p-2" />}
        <p className="max-w-xl break-all text-lg text-muted">{sale.payment?.qrPayload}</p>
        <p>Expira em {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}</p>
      </Screen>
    );
  }
  if (keypad) {
    return (
      <Screen title="CPF na nota">
        <p className="min-h-12 text-4xl tracking-widest">{formatCpfDraft(cpfDraft) || "Digite o CPF"}</p>
        {notice && <Alert tone="warning" className="text-xl">{notice}</Alert>}
        <div className="grid grid-cols-3 gap-3">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
            <Button
              key={d}
              size="touch"
              variant="secondary"
              className="w-28 px-0 font-semibold"
              onClick={() => setCpfDraft((v) => (v + d).slice(0, 11))}
            >
              {d}
            </Button>
          ))}
          <Button
            size="touch"
            variant="secondary"
            className="w-28 px-0"
            onClick={() => setCpfDraft((v) => v.slice(0, -1))}
            aria-label="Apagar"
          >
            Apagar
          </Button>
          <Button
            size="touch"
            variant="secondary"
            className="w-28 px-0 font-semibold"
            onClick={() => setCpfDraft((v) => (v + "0").slice(0, 11))}
          >
            0
          </Button>
          <Button size="touch" variant="secondary" className="w-28 px-0" onClick={() => setCpfDraft("")}>
            Limpar
          </Button>
        </div>
        <Button size="touch" onClick={() => saveCpf(cpfDraft)} disabled={cpfDraft.length !== 11}>
          Confirmar
        </Button>
        <Button size="touch" variant="secondary" onClick={() => saveCpf(null)}>
          Sem CPF
        </Button>
        <Button
          size="touch"
          variant="secondary"
          onClick={() => {
            setKeypad(false);
            setCpfDraft("");
          }}
        >
          Voltar
        </Button>
      </Screen>
    );
  }
  return (
    <Screen title="Seu carrinho">
      {paymentNotice(sale) && <Alert tone="warning" className="text-xl">{paymentNotice(sale)}</Alert>}
      {notice && <Alert tone="warning" className="text-xl">{notice}</Alert>}
      <ul className="m-0 w-full max-w-2xl list-none space-y-3 p-0">
        {sale.items.map((i) => (
          <li key={i.id} className="flex items-center justify-center gap-4">
            <Button size="touch" variant="secondary" className="w-16 px-0" onClick={() => changeQuantity(i, -1)} aria-label="Menos">
              -
            </Button>
            <span className="flex-1">
              {i.quantity} x {i.productName} ({formatBRL(i.unitPriceCents)})
            </span>
            <Button size="touch" variant="secondary" className="w-16 px-0" onClick={() => changeQuantity(i, 1)} aria-label="Mais">
              +
            </Button>
          </li>
        ))}
      </ul>
      <p className="text-4xl">
        <strong>Total: {formatBRL(sale.totalCents)}</strong>
      </p>
      <p className="text-muted">{sale.customerCpfMasked ? `CPF na nota: ${sale.customerCpfMasked}` : "Sem CPF na nota"}</p>
      <Button size="touch" variant="secondary" onClick={() => setKeypad(true)}>
        {sale.customerCpfMasked ? "Alterar CPF" : "CPF na nota"}
      </Button>
      <Button size="touch" className="min-w-72" onClick={() => startPay("pix")} disabled={sale.items.length === 0}>
        Pagar com Pix
      </Button>
      <Button size="touch" className="min-w-72" onClick={() => startPay("card")} disabled={sale.items.length === 0}>
        Pagar com cartão
      </Button>
      <Button size="touch" variant="secondary" onClick={cancel}>
        Cancelar
      </Button>
    </Screen>
  );
}
```

Nota: todos os botões de toque ficam em `text-2xl` (classes de tamanho de texto não sobrescrevem as do componente, ver Global Constraints); por isso as teclas do teclado numérico usam `w-28` (112 px), largura em que "Apagar" e "Limpar" cabem.

- [ ] **Step 4: Verificar tipos, testes e build**

Run: `npm run typecheck && npm test && npm run build`
Expected: sem erros. `grep -n "CSSProperties\|style={" src/app/pdv/PdvApp.tsx` não retorna nada.

- [ ] **Step 5: Conferência manual no PDV**

Com `npm run dev`: cadastrar um totem (Totens), copiar o token e abrir `http://localhost:3000/pdv#token=<token>` numa janela de 1080 x 1920 (DevTools, dispositivo personalizado, toque). Percorrer: Bem-vindo (logo), digitar um código de barras de produto ativo no teclado (o leitor funciona como teclado; o item entra), carrinho com mais e menos, CPF (teclado numérico, Confirmar, Sem CPF, Voltar), Pix (QR e contagem), cartão (se houver simulador, ver README), pagamento confirmado (Obrigado), token inválido (tela de configuração), totem revogado, offline (desligar a rede). Conferir: leitura por teclado continua funcionando com um botão focado (Enter não aciona o botão), botões com pelo menos 64 px, texto legível a 1 m, claro e escuro.
Verificar também o Chromium do totem: a versão instalada pelo agente (`agent/`) deve ser Chrome 111 ou mais (requisito do Tailwind v4); se `agent/` fixar uma versão menor, registrar no README e avisar.

- [ ] **Step 6: Commit**

```bash
git add src/app/pdv/PdvApp.tsx
git commit -m "feat: touch-scale PDV with Tailwind components"
```

---

### Task 10: Documentação e verificação final

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Atualizar o README**

Ler `README.md` (seções "Estrutura do repositório", "Testes" e a tabela de roadmap) e:
1. Em "Estrutura do repositório", acrescentar a linha de `src/ui/` (componentes da interface em React com Tailwind, tokens em `src/app/globals.css`) e de `public/` (logos), no mesmo formato das linhas vizinhas.
2. Em "Funcionalidades", na linha "Painel do dono", acrescentar que a interface tem modo claro e escuro.
3. Atualizar o número do selo de testes e qualquer menção a "665 testes" para o total real de `npm test` (a saída `Tests  N passed`).
4. Em "Próximas" do roadmap, acrescentar: `grade de produtos tocáveis no PDV`.

- [ ] **Step 2: Verificação final**

Run: `npm run typecheck && npm test && npm run build`
Expected: tudo verde. Anotar o total de testes.
Run: `git status --short`
Expected: limpo, exceto `README.md`.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document the design system"
```
