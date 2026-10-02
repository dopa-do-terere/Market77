import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Sql } from "postgres";

const DIR = path.join(process.cwd(), "src/db/migrations");

/** Applies pending .sql files in name order. Returns the names applied. */
export async function migrate(sql: Sql): Promise<string[]> {
  await sql`create table if not exists schema_migrations (
    name text primary key, applied_at timestamptz not null default now())`;
  const done = new Set((await sql`select name from schema_migrations`).map((r) => r.name as string));
  const files = (await readdir(DIR)).filter((f) => f.endsWith(".sql")).sort();
  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const text = await readFile(path.join(DIR, file), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(text);
      await tx`insert into schema_migrations (name) values (${file})`;
    });
    applied.push(file);
  }
  return applied;
}
