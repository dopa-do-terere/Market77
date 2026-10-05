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
