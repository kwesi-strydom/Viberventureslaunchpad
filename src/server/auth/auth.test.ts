import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as schema from "../../db/schema.ts";
import { createApp } from "../app.ts";
import type { AuthConfig } from "./config.ts";
import { loadAuthConfig } from "./config.ts";
import { accountAgeOk, upsertGithubUser, type GithubProfile } from "./github.ts";
import {
  createSession, destroySession, getSessionUser, hashToken, parseCookies, serializeCookie, safeEqual, type Db,
} from "./session.ts";

const cfg: AuthConfig = {
  appUrl: "http://localhost:5001",
  githubClientId: "cid",
  githubClientSecret: "secret",
  adminHandles: ["boss"],
  minAccountAgeDays: 14,
  secureCookies: false,
};

let pg: PGlite;
let db: Db;
let server: Server;
let base: string;
let githubUser: GithubProfile;
const fakeFetch = (async (url: string | URL | Request) => {
  const u = String(url);
  if (u.includes("/login/oauth/access_token")) return new Response(JSON.stringify({ access_token: "gho_fake" }), { status: 200 });
  if (u.includes("api.github.com/user")) return new Response(JSON.stringify(githubUser), { status: 200 });
  return new Response("nope", { status: 404 });
}) as typeof fetch;

before(async () => {
  pg = new PGlite();
  const d = drizzle(pg, { schema });
  await migrate(d, { migrationsFolder: "./drizzle" }); // also proves the generated SQL is valid
  db = d as unknown as Db;
  server = createApp({ db, auth: cfg, fetchImpl: fakeFetch }).listen(0);
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});
after(async () => { server.close(); await pg.close(); });

const profile = (over: Partial<GithubProfile> = {}): GithubProfile => ({
  id: 1001, login: "alice", name: "Alice", avatar_url: "http://a/x.png", created_at: "2020-01-01T00:00:00Z", ...over,
});

test("cookies: parse and serialize", () => {
  assert.deepEqual(parseCookies("a=1; b=hello%20world; bad=%E0%A4%A"), { a: "1", b: "hello world" });
  const c = serializeCookie("s", "v", { maxAgeSeconds: 60, secure: true });
  for (const part of ["s=v", "HttpOnly", "SameSite=Lax", "Max-Age=60", "Secure", "Path=/"]) assert.ok(c.includes(part), part);
  assert.ok(!serializeCookie("s", "v", { maxAgeSeconds: 60, secure: false }).includes("Secure"));
  assert.ok(safeEqual("abc", "abc") && !safeEqual("abc", "abd") && !safeEqual("abc", "ab"));
});

test("config: needs both GitHub credentials; reads options", () => {
  assert.equal(loadAuthConfig({ GITHUB_CLIENT_ID: "x" }), null);
  const c = loadAuthConfig({ GITHUB_CLIENT_ID: "x", GITHUB_CLIENT_SECRET: "y", APP_URL: "https://o.example/", ADMIN_GITHUB_HANDLES: " Boss, ,Ann", MIN_GITHUB_ACCOUNT_AGE_DAYS: "0" })!;
  assert.deepEqual([c.appUrl, c.secureCookies, c.minAccountAgeDays, c.adminHandles], ["https://o.example", true, 0, ["boss", "ann"]]);
});

test("account age gate", () => {
  const now = new Date("2026-10-16T00:00:00Z");
  assert.equal(accountAgeOk("2026-10-10T00:00:00Z", 14, now), false);
  assert.equal(accountAgeOk("2026-09-01T00:00:00Z", 14, now), true);
  assert.equal(accountAgeOk("2026-10-15T00:00:00Z", 0, now), true);
  assert.equal(accountAgeOk("not a date", 14, now), false);
});

test("users: upsert refreshes profile, promotes configured admins, never demotes", async () => {
  const a = await upsertGithubUser(db, profile(), cfg);
  assert.equal(a.role, "participant");
  const a2 = await upsertGithubUser(db, profile({ name: "Alice B" }), cfg);
  assert.equal(a2.id, a.id);
  assert.equal(a2.name, "Alice B");
  const boss = await upsertGithubUser(db, profile({ id: 2002, login: "Boss" }), cfg);
  assert.equal(boss.role, "admin");
  const still = await upsertGithubUser(db, profile({ id: 2002, login: "Boss" }), { ...cfg, adminHandles: [] });
  assert.equal(still.role, "admin");
});

test("sessions: stored hashed, expire, destroy, banned users rejected", async () => {
  const u = await upsertGithubUser(db, profile({ id: 3003, login: "carol" }), cfg);
  const now = new Date("2026-10-01T00:00:00Z");
  const { token, expiresAt } = await createSession(db, u.id, now);
  const rows = await db.select().from(schema.sessions).where(eq(schema.sessions.userId, u.id));
  assert.equal(rows[0].tokenHash, hashToken(token));
  assert.notEqual(rows[0].tokenHash, token);
  assert.equal((await getSessionUser(db, token, now))?.id, u.id);
  assert.equal(await getSessionUser(db, token, new Date(expiresAt.getTime() + 1000)), null);
  assert.equal(await getSessionUser(db, "garbage", now), null);
  assert.equal(await getSessionUser(db, undefined, now), null);
  await db.update(schema.users).set({ status: "banned" }).where(eq(schema.users.id, u.id));
  assert.equal(await getSessionUser(db, token, now), null);
  await db.update(schema.users).set({ status: "active" }).where(eq(schema.users.id, u.id));
  await destroySession(db, token);
  assert.equal(await getSessionUser(db, token, now), null);
});

// ---- HTTP flow with a fake GitHub ----
const setCookies = (res: Response) => res.headers.getSetCookie();
const cookieValue = (res: Response, name: string) =>
  setCookies(res).map((c) => c.split(";")[0]).find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1);

test("http: login start sets a state cookie and redirects to GitHub", async () => {
  const res = await fetch(`${base}/api/auth/github`, { redirect: "manual" });
  assert.equal(res.status, 302);
  const loc = new URL(res.headers.get("location")!);
  assert.equal(loc.origin + loc.pathname, "https://github.com/login/oauth/authorize");
  assert.equal(loc.searchParams.get("client_id"), "cid");
  assert.equal(loc.searchParams.get("state"), decodeURIComponent(cookieValue(res, "viber_oauth_state")!));
});

async function startLogin() {
  const res = await fetch(`${base}/api/auth/github`, { redirect: "manual" });
  const state = new URL(res.headers.get("location")!).searchParams.get("state")!;
  return { state, cookie: `viber_oauth_state=${encodeURIComponent(state)}` };
}

test("http: callback rejects a missing or mismatched state", async () => {
  const { state } = await startLogin();
  const noCookie = await fetch(`${base}/api/auth/github/callback?code=c&state=${state}`, { redirect: "manual" });
  assert.equal(noCookie.headers.get("location"), "/?login=bad_state");
  const wrong = await fetch(`${base}/api/auth/github/callback?code=c&state=other`, { redirect: "manual", headers: { cookie: `viber_oauth_state=${state}` } });
  assert.equal(wrong.headers.get("location"), "/?login=bad_state");
  assert.equal(cookieValue(wrong, "viber_session"), undefined);
});

test("http: too-new GitHub accounts are refused", async () => {
  githubUser = profile({ id: 4004, login: "newbie", created_at: new Date().toISOString() });
  const { state, cookie } = await startLogin();
  const res = await fetch(`${base}/api/auth/github/callback?code=c&state=${state}`, { redirect: "manual", headers: { cookie } });
  assert.equal(res.headers.get("location"), "/?login=account_too_new");
  assert.equal(cookieValue(res, "viber_session"), undefined);
});

test("http: full login, /me, cross-origin logout blocked, logout", async () => {
  githubUser = profile({ id: 5005, login: "dave", name: "Dave" });
  const { state, cookie } = await startLogin();
  const res = await fetch(`${base}/api/auth/github/callback?code=c&state=${state}`, { redirect: "manual", headers: { cookie } });
  assert.equal(res.headers.get("location"), "/");
  const session = cookieValue(res, "viber_session")!;
  assert.ok(session);
  assert.ok(setCookies(res).some((c) => c.startsWith("viber_session=") && c.includes("HttpOnly") && c.includes("SameSite=Lax")));
  const sc = `viber_session=${session}`;

  const me = await fetch(`${base}/api/auth/me`, { headers: { cookie: sc } });
  assert.equal(me.status, 200);
  const body = (await me.json()) as { user: { handle: string; role: string } };
  assert.deepEqual([body.user.handle, body.user.role], ["dave", "participant"]);
  assert.equal((await fetch(`${base}/api/auth/me`)).status, 401);

  const evil = await fetch(`${base}/api/auth/logout`, { method: "POST", headers: { cookie: sc, origin: "https://evil.example" } });
  assert.equal(evil.status, 403);
  assert.equal((await fetch(`${base}/api/auth/me`, { headers: { cookie: sc } })).status, 200);

  const out = await fetch(`${base}/api/auth/logout`, { method: "POST", headers: { cookie: sc, origin: cfg.appUrl } });
  assert.equal(out.status, 200);
  assert.equal((await fetch(`${base}/api/auth/me`, { headers: { cookie: sc } })).status, 401);
});

test("http: login is disabled with a clear message when not configured", async () => {
  const app = createApp({});
  const s = app.listen(0);
  try {
    const port = (s.address() as AddressInfo).port;
    const res = await fetch(`http://localhost:${port}/api/auth/github`);
    assert.equal(res.status, 503);
    const health = (await (await fetch(`http://localhost:${port}/api/health`)).json()) as { login: boolean };
    assert.equal(health.login, false);
  } finally {
    s.close();
  }
});
