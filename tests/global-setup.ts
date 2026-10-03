import postgres from "postgres";
import { migrate } from "../src/db/migrate";

/** Creates the test database when it does not exist yet (parallel worktrees use TEST_DB), then migrates it. */
async function ensureDatabase(): Promise<void> {
  const url = new URL(process.env.DATABASE_URL!);
  const name = url.pathname.slice(1);
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`Unsafe test database name: ${name}`);
  const root = postgres(new URL("/postgres", url).toString(), { max: 1 });
  try {
    const [row] = await root`select 1 from pg_database where datname = ${name}`;
    if (!row) {
      try {
        await root.unsafe(`create database "${name}"`);
      } catch (e) {
        if ((e as { code?: string }).code !== "42P04") throw e; // someone else created it first
      }
    }
  } finally {
    await root.end();
  }
}

export default async function setup() {
  await ensureDatabase();
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  await migrate(sql);
  await sql.end();
}
