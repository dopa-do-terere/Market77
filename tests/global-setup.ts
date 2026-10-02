import postgres from "postgres";
import { migrate } from "../src/db/migrate";

export default async function setup() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  await migrate(sql);
  await sql.end();
}
