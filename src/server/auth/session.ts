import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "../../db/schema.ts";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export type User = typeof schema.users.$inferSelect;

export const SESSION_COOKIE = "viber_session";
export const STATE_COOKIE = "viber_oauth_state";
export const SESSION_TTL_DAYS = 14;

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Only the hash is stored, so a database leak cannot be replayed as a login. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const name = part.slice(0, i).trim();
    if (!name || name in out) continue;
    try {
      out[name] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      /* ignore malformed cookie values */
    }
  }
  return out;
}

export function serializeCookie(
  name: string,
  value: string,
  opts: { maxAgeSeconds: number; secure: boolean },
): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, Math.floor(opts.maxAgeSeconds))}`,
  ];
  if (opts.secure) parts.push("Secure");
  return parts.join("; ");
}

export async function createSession(db: Db, userId: string, now = new Date()) {
  const token = newToken();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_DAYS * 24 * 3600 * 1000);
  await db.insert(schema.sessions).values({ tokenHash: hashToken(token), userId, expiresAt });
  return { token, expiresAt };
}

/** Returns the signed-in, non-banned user for a raw session token, or null. */
export async function getSessionUser(db: Db, token: string | undefined, now = new Date()): Promise<User | null> {
  if (!token) return null;
  const rows = await db
    .select({ user: schema.users })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(and(eq(schema.sessions.tokenHash, hashToken(token)), gt(schema.sessions.expiresAt, now)))
    .limit(1);
  const user = rows[0]?.user;
  return user && user.status === "active" ? user : null;
}

export async function destroySession(db: Db, token: string | undefined) {
  if (!token) return;
  await db.delete(schema.sessions).where(eq(schema.sessions.tokenHash, hashToken(token)));
}
