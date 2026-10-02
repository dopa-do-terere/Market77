import path from "node:path";
import { defineConfig } from "vitest/config";

const env = {
  DATABASE_URL: "postgres://market77:market77@localhost:5432/market77_test",
  DATABASE_APP_URL: "postgres://market77_app:market77_app@localhost:5432/market77_test",
};
Object.assign(process.env, env);

export default defineConfig({
  resolve: { alias: { "@": path.resolve("src") } },
  test: {
    env,
    globalSetup: ["tests/global-setup.ts"],
    fileParallelism: false, // tests share one database
    hookTimeout: 30000,
  },
});
