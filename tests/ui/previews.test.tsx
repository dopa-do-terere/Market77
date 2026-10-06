import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import PreviewLayout from "@/app/ui/dashboard/layout";
import ScreenPreview from "@/app/ui/dashboard/[...section]/page";
import PdvPreview from "@/app/ui/pdv/page";

afterEach(() => vi.unstubAllEnvs());

describe("development previews", () => {
  it("keeps the preview layout out of production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => PreviewLayout({ children: null })).toThrow();
  });
  it("keeps screen previews out of production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(ScreenPreview({ params: Promise.resolve({ section: ["products"] }) })).rejects.toThrow();
  });
  it("keeps the PDV preview out of production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => PdvPreview()).toThrow();
  });
  it.each(["products", "terminals", "team", "settings/payments", "markets/aurora", "markets/aurora/access"])("renders %s without enabling fixture writes", async (section) => {
    vi.stubEnv("NODE_ENV", "development");
    const page = await ScreenPreview({ params: Promise.resolve({ section: section.split("/") }) });
    const html = renderToStaticMarkup(page);
    expect(html).toContain("<h1");
    expect(html).toContain("<fieldset disabled");
    expect(html).not.toContain("<form");
  });
  it("returns 404 for an unknown preview instead of inventing a screen", async () => {
    vi.stubEnv("NODE_ENV", "development");
    await expect(ScreenPreview({ params: Promise.resolve({ section: ["unknown"] }) })).rejects.toThrow();
  });
});
