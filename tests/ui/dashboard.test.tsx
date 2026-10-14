import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import DashboardPreview from "@/app/ui/dashboard/page";
import { DashboardOverview, type DashboardOverviewProps } from "@/ui/DashboardOverview";

const props: DashboardOverviewProps = {
  base: "/o/example", markets: [], today: null, offline: null, fiscalErrors: null, canCreateMarket: false,
};
afterEach(() => vi.unstubAllEnvs());

describe("dashboard presentation", () => {
  it("keeps restricted sales, terminal and creation actions out of the page", () => {
    const html = renderToStaticMarkup(<DashboardOverview {...props} />);
    expect(html).not.toContain("/sales");
    expect(html).not.toContain("/terminals");
    expect(html).not.toContain("#new-market");
    expect(html).not.toContain("Ticket médio");
    expect(html).toContain("Seu primeiro mercado começa aqui");
  });
  it("handles no paid sales without an invalid average", () => {
    const html = renderToStaticMarkup(<DashboardOverview {...props} today={{ totalCents: 0, count: 0 }} />);
    expect(html).toContain("Ainda não há vendas pagas hoje");
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("Infinity");
  });
  it("shows actual stock alerts and links to the affected market", () => {
    const html = renderToStaticMarkup(<DashboardOverview {...props} markets={[{ id: "unit", name: "Aurora", address: null, lowCount: 3, expired: 2 }]} offline={1} fiscalErrors={2} />);
    expect(html).toContain('/o/example/markets/unit');
    expect(html).toContain("3 com estoque baixo");
    expect(html).toContain("2 lotes vencidos");
    expect(html).toContain("/o/example/terminals");
    expect(html).toContain("/o/example/sales");
    expect(html).not.toContain("Sem alertas de estoque");
  });
  it("does not expose the illustrative preview in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => DashboardPreview()).toThrow();
  });
});
