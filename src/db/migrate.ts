import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

/**
 * Applies the reviewed SQL files in ./drizzle. Uses the direct (unpooled) URL when present.
 * Run against a Neon *branch* first; never point it at data you cannot restore.
 */
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) {
  console.error("No DATABASE_URL_UNPOOLED or DATABASE_URL set. Run `neon link` or fill .env.local.");
  process.exit(1);
}
const host = new URL(url).host;
console.log(`Migrating ${process.env.NEON_BRANCH ?? "(unknown branch)"} on ${host} ...`);

const pool = new pg.Pool({ connectionString: url, max: 1 });
try {
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  console.log("Migrations applied.");
} finally {
  await pool.end();
}
