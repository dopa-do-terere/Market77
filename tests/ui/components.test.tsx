import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { COMMAND_STATUS_LABEL, FISCAL_LABEL, PAYMENT_LABEL, STATUS_LABEL } from "@/lib/labels";
import {
  Alert,
  Badge,
  Button,
  AuthShell,
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

describe("AuthShell", () => {
  it("renders the title as h1", () => {
    const out = html(<AuthShell title="Entrar">x</AuthShell>);
    expect(out).toContain("<h1");
    expect(out).toContain("Entrar");
  });
});
