import path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

// TEST_DB lets parallel worktrees each use their own database (created on demand by global-setup).
const db = process.env.TEST_DB ?? "market77_test";
const env = {
  DATABASE_URL: `postgres://market77:market77@localhost:5432/${db}`,
  DATABASE_APP_URL: `postgres://market77_app:market77_app@localhost:5432/${db}`,
  PIX_PROVIDER: "fake",
  FAKE_PIX_SECRET: "test-fake-secret",
  RECONCILE_SECRET: "test-reconcile-secret",
};
Object.assign(process.env, env);

export default defineConfig({
  resolve: { alias: { "@": path.resolve("src") } },
  test: {
    env,
    exclude: [...configDefaults.exclude, ".claude/**"], // parallel agent worktrees live there
    globalSetup: ["tests/global-setup.ts"],
    fileParallelism: false, // tests share one database
    hookTimeout: 30000,
  },
});
