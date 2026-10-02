import express, { type NextFunction, type Request, type RequestHandler, type Response } from "express";
import type { AuthConfig } from "./config.ts";
import { accountAgeOk, buildAuthorizeUrl, exchangeCode, fetchGithubProfile, upsertGithubUser } from "./github.ts";
import {
  SESSION_COOKIE, SESSION_TTL_DAYS, STATE_COOKIE, createSession, destroySession, getSessionUser,
  newToken, parseCookies, safeEqual, serializeCookie, type Db, type User,
} from "./session.ts";

declare module "express-serve-static-core" {
  interface Locals {
    user?: User | null;
  }
}

/** Loads the signed-in user (if any) into res.locals.user. */
export function attachUser(db: Db): RequestHandler {
  return async (req, res, next) => {
    try {
      const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
      res.locals.user = await getSessionUser(db, token);
      next();
    } catch (err) {
      next(err);
    }
  };
}

export const requireUser: RequestHandler = (_req, res, next) => {
  if (!res.locals.user) return void res.status(401).json({ message: "Sign in required." });
  next();
};

export const requireAdmin: RequestHandler = (_req, res, next) => {
  const u = res.locals.user;
  if (!u) return void res.status(401).json({ message: "Sign in required." });
  if (u.role !== "admin") return void res.status(403).json({ message: "Admins only." });
  next();
};

/** CSRF defence for cookie sessions: state-changing requests must come from our own origin. */
export function sameOriginWrites(cfg: Pick<AuthConfig, "appUrl">): RequestHandler {
  const allowed = new URL(cfg.appUrl).origin;
  return (req, res, next) => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
    if (req.headers.origin !== allowed) return void res.status(403).json({ message: "Cross-origin request blocked." });
    next();
  };
}

export function createAuthRouter(opts: { db: Db; cfg: AuthConfig; fetchImpl?: typeof fetch }) {
  const { db, cfg, fetchImpl } = opts;
  const router = express.Router();
  const secure = cfg.secureCookies;
  const clear = (name: string) => serializeCookie(name, "", { maxAgeSeconds: 0, secure });

  router.get("/github", (_req, res) => {
    const state = newToken();
    res.setHeader("Set-Cookie", serializeCookie(STATE_COOKIE, state, { maxAgeSeconds: 600, secure }));
    res.redirect(302, buildAuthorizeUrl(cfg, state));
  });

  router.get("/github/callback", async (req: Request, res: Response) => {
    const cookies = parseCookies(req.headers.cookie);
    const expected = cookies[STATE_COOKIE];
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const fail = (reason: string) => {
      res.setHeader("Set-Cookie", clear(STATE_COOKIE));
      res.redirect(302, `/?login=${reason}`);
    };

    if (!expected || !state || !safeEqual(expected, state)) return fail("bad_state");
    if (req.query.error || !code) return fail("denied");

    try {
      const accessToken = await exchangeCode(cfg, code, fetchImpl);
      const profile = await fetchGithubProfile(accessToken, fetchImpl);
      if (!accountAgeOk(profile.created_at, cfg.minAccountAgeDays)) return fail("account_too_new");
      const user = await upsertGithubUser(db, profile, cfg);
      if (user.status !== "active") return fail("banned");
      const session = await createSession(db, user.id);
      res.setHeader("Set-Cookie", [
        serializeCookie(SESSION_COOKIE, session.token, { maxAgeSeconds: SESSION_TTL_DAYS * 24 * 3600, secure }),
        clear(STATE_COOKIE),
      ]);
      res.redirect(302, "/");
    } catch (err) {
      console.error("GitHub login failed:", err instanceof Error ? err.message : "unknown error");
      fail("error");
    }
  });

  router.get("/me", attachUser(db), (_req, res) => {
    const u = res.locals.user;
    if (!u) return void res.status(401).json({ user: null });
    res.json({ user: { id: u.id, handle: u.handle, name: u.name, avatarUrl: u.avatarUrl, role: u.role } });
  });

  router.post("/logout", sameOriginWrites(cfg), async (req, res, next) => {
    try {
      await destroySession(db, parseCookies(req.headers.cookie)[SESSION_COOKIE]);
      res.setHeader("Set-Cookie", clear(SESSION_COOKIE));
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

export type { NextFunction };
