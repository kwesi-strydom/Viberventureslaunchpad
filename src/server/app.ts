import express from "express";
import type { AuthConfig } from "./auth/config.ts";
import { createAuthRouter } from "./auth/routes.ts";
import type { Db } from "./auth/session.ts";

/** Builds the Express app. Kept separate from listen() so tests can run it in-process. */
export function createApp(opts: { db?: Db; auth?: AuthConfig | null; fetchImpl?: typeof fetch } = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "100kb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, service: "viber-online", time: new Date().toISOString(), login: Boolean(opts.db && opts.auth) });
  });

  if (opts.db && opts.auth) {
    app.use("/api/auth", createAuthRouter({ db: opts.db, cfg: opts.auth, fetchImpl: opts.fetchImpl }));
  } else {
    app.use("/api/auth", (_req, res) => {
      res.status(503).json({ message: "Login is not configured on this server yet." });
    });
  }
  return app;
}
