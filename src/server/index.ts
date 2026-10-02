import { getDb } from "../db/index.ts";
import { loadAuthConfig } from "./auth/config.ts";
import { createApp } from "./app.ts";

const auth = loadAuthConfig();
const db = process.env.DATABASE_URL ? getDb() : undefined;
if (!db) console.warn("DATABASE_URL is not set: running without a database.");
if (!auth) console.warn("GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET not set: login is disabled.");

const app = createApp({ db, auth });
const port = Number(process.env.PORT ?? 5001);
app.listen(port, "0.0.0.0", () => {
  console.log(`viber-online listening on :${port}`);
});
