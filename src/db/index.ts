import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema.ts";

let pool: pg.Pool | undefined;

/** Lazily create the pool so tools that only import types never need a database. */
export function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local or run `neon link`.");
  pool ??= new pg.Pool({ connectionString: url, max: 10 });
  return drizzle(pool, { schema });
}

export async function closeDb() {
  await pool?.end();
  pool = undefined;
}
