import { adminSql } from "../src/db/client";
import { migrate } from "../src/db/migrate";

async function main() {
  const applied = await migrate(adminSql);
  console.log(applied.length ? `applied: ${applied.join(", ")}` : "up to date");
  await adminSql.end();
}
main();
