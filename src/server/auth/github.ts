import { eq } from "drizzle-orm";
import * as schema from "../../db/schema.ts";
import type { AuthConfig } from "./config.ts";
import type { Db, User } from "./session.ts";

export interface GithubProfile {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
  created_at: string;
}

type FetchLike = typeof fetch;

export function buildAuthorizeUrl(cfg: AuthConfig, state: string): string {
  const u = new URL("https://github.com/login/oauth/authorize");
  u.searchParams.set("client_id", cfg.githubClientId);
  u.searchParams.set("redirect_uri", `${cfg.appUrl}/api/auth/github/callback`);
  u.searchParams.set("state", state);
  u.searchParams.set("allow_signup", "true");
  return u.toString(); // no scope: public profile only
}

export async function exchangeCode(cfg: AuthConfig, code: string, fetchImpl: FetchLike = fetch): Promise<string> {
  const res = await fetchImpl("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: cfg.githubClientId,
      client_secret: cfg.githubClientSecret,
      code,
      redirect_uri: `${cfg.appUrl}/api/auth/github/callback`,
    }),
  });
  if (!res.ok) throw new Error(`GitHub token exchange failed (${res.status})`);
  const body = (await res.json()) as { access_token?: string; error?: string };
  if (!body.access_token) throw new Error(`GitHub token exchange rejected: ${body.error ?? "no token"}`);
  return body.access_token;
}

export async function fetchGithubProfile(accessToken: string, fetchImpl: FetchLike = fetch): Promise<GithubProfile> {
  const res = await fetchImpl("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/vnd.github+json", "User-Agent": "viber-online" },
  });
  if (!res.ok) throw new Error(`GitHub profile request failed (${res.status})`);
  const p = (await res.json()) as GithubProfile;
  if (typeof p.id !== "number" || !p.login || !p.created_at) throw new Error("Unexpected GitHub profile response");
  return p;
}

export function accountAgeOk(createdAt: string | Date, minDays: number, now = new Date()): boolean {
  if (minDays <= 0) return true;
  const created = new Date(createdAt).getTime();
  if (Number.isNaN(created)) return false;
  return now.getTime() - created >= minDays * 24 * 3600 * 1000;
}

/** Create or refresh the user. Handles listed in ADMIN_GITHUB_HANDLES are promoted; nobody is auto-demoted. */
export async function upsertGithubUser(db: Db, profile: GithubProfile, cfg: AuthConfig): Promise<User> {
  const githubId = String(profile.id);
  const makeAdmin = cfg.adminHandles.includes(profile.login.toLowerCase());
  const fields = {
    handle: profile.login,
    name: profile.name,
    avatarUrl: profile.avatar_url,
    githubCreatedAt: new Date(profile.created_at),
  };
  const [row] = await db
    .insert(schema.users)
    .values({ githubId, ...fields, role: makeAdmin ? "admin" : "participant" })
    .onConflictDoUpdate({ target: schema.users.githubId, set: fields })
    .returning();
  if (makeAdmin && row.role !== "admin") {
    const [promoted] = await db.update(schema.users).set({ role: "admin" }).where(eq(schema.users.id, row.id)).returning();
    return promoted;
  }
  return row;
}
