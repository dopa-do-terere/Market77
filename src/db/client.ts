import postgres, { type Sql } from "postgres";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

// Cached on globalThis so Next dev hot reload does not open new pools every edit.
const g = globalThis as unknown as { __m77?: { admin: Sql; app: Sql } };
g.__m77 ??= {
  admin: postgres(required("DATABASE_URL"), { max: 5 }),
  app: postgres(required("DATABASE_APP_URL"), { max: 10 }),
};

/** Owner connection: bypasses RLS. Only auth code, migrations, and the provider webhook and reconcile sweep (only to find the organization; everything else goes through withOrg) may use it. */
export const adminSql = g.__m77.admin;
/** Application role: subject to RLS. All business data goes through withOrg(). */
export const appSql = g.__m77.app;
