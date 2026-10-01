# Viber Online Launchpad — Spec v0.1

Status: draft for review by Stephane and Mathis. Target: online qualifier ~9–11 Oct 2026,
live final Fri 16 Oct 2026 at Network School Astana, with Superteam Kazakhstan.

## 1. Goals

1. Let hundreds of people compete online in one shared Viber competition, esports style.
2. Deliver the entrepreneurial challenges (and bonus events) to every participant
   automatically, so the event does not depend on one operator.
3. Keep entry gated and secure: one real person, one account.
4. Control AI model access per team so challenges have real effects, and keep an audit trail.
5. Funnel the best builders into Network School incubation and Spark ideas.

Non-goals for the first release: Higgsfield integration, Spark bounty payouts, built-in
mini-games, team formation online (online entries are solo).

## 2. Why a separate platform

The live Launchpad (`viberventures`) shares one Neon database between its dev and
deployed environments, uses a deliberately loose session setup, and is optimised for a
single room. Online needs hardened auth, targeted delivery, scheduled events and a model
gateway. A new repo with its own database avoids risk to live data.

Reuse from the live platform (port with tests, do not copy by hand):
- the manual timer (row-locked, transactional),
- the wheel progress store (atomic, persisted, retry-safe),
- the idea of a linked event with a roster.

## 3. Architecture

```
Participants (browser)  <--WebSocket + poll fallback-->  App server (Express)
                                                           |  \
                                              Postgres (Neon) \__ Admin console
                                                           |
                                                     Event engine (runner)
                                                           |
                                              policy table (per team/user)
                                                           |
                                            LLM Gateway (separate service)
                                                           |
                                                  Model providers
```

- **App server**: TypeScript, Express, Drizzle, Postgres. React + Vite client.
- **Event engine**: reads the schedule and applies effects; every action is idempotent
  and recorded. The operator can fire, skip, cancel or reschedule anything.
- **Gateway**: separate small service. Issues per-team API keys, enforces budgets and
  rate limits, logs requests, and routes to the model named in the team's current policy.
  If it fails, teams fall back to their own keys (fallback mode, logged).
- **Realtime**: targeted delivery by user/team/room, plus a short poll as a fallback so a
  dropped socket never hides a challenge. Respect cost limits: no always-open polling on
  hidden tabs.

## 4. Core model: the event engine

A **schedule item** is:

| Field | Meaning |
|---|---|
| `at` | absolute time, or offset from the event clock |
| `target` | all, team, user, random N, bottom N, room |
| `effect` | what happens (see below) |
| `duration` | how long it lasts |
| `announcement` | banner text, stream overlay text |
| `status` | planned, fired, skipped, cancelled, failed |

Effect types:
- `banner` — announce only (the current wheel behaviour)
- `degrade_model` — set the target's model policy to a weaker model for the duration
- `cap_budget` — reduce token budget for the duration
- `inject_constraint` — push a new requirement ("pivot", "feature demand")
- `grant_bonus` — extra time, tokens, model upgrade, immunity, mentor slot
- `minigame` — start a mini-game round; winners receive `grant_bonus`
- `response_required` — participant must submit a short text or video answer (investor call, press ambush)

The existing challenges map to effects: Founders Dispute (live only: team swap),
Copyright Strike (`inject_constraint`: rename and rebrand), Server Crash (`degrade_model`),
Lawsuit (`inject_constraint` + `response_required`), Safe (`banner`).
The Wheel of Destiny becomes the selector for target and effect, and can be run
manually or automatically.

Bonuses live in a **ledger** (append-only) so every advantage is visible and capped.

## 5. Data (first migration)

Core tables (names indicative):
- `users` (GitHub id, handle, status), `sessions`
- `events` (name, mode: online|live|hybrid, starts_at, rounds)
- `participants` (user, event, team, role, status)
- `teams` (event, name, solo flag)
- `schedule_items`, `schedule_runs` (idempotency and audit)
- `effects_active` (target, effect, started_at, ends_at)
- `bonus_ledger`
- `model_policies` (target, model alias, token budget, rate limit, valid_until)
- `submissions`, `votes`, `scores`
- `audit_log`

All migrations are additive and reviewed. Use a Neon branch for testing; never test on `production`.

## 6. Security and gating

- Login with GitHub OAuth; one account per GitHub user; minimum account age / activity
  threshold to reduce throwaway accounts (tunable).
- Optional proof of community: Superteam KZ / NS invite code or membership check.
- Sessions: httpOnly, secure, sameSite cookies; CSRF protection and a real OAuth `state` nonce.
- No password login at all for online accounts (removes the plaintext-password risk).
- Rate limits on registration, voting and submissions; one vote per verified user.
- Admin roles with audit log; every admin action recorded.
- Gateway keys are per team, budget-capped, revocable, never shown in logs.
- Secrets only in environment variables, never in the repo.

## 7. Operator console

Fire/skip/cancel/reschedule any item; pause everything (kill switch); switch gateway to
fallback mode; edit bonuses; manually grant bonuses (for manual mini-games); view live
state of every team; run a rehearsal mode with fake clients.

## 8. Phases

**Phase 0 — before 16 Oct**
1. Repo, Neon project, auth (GitHub), registration and onboarding.
2. Event engine: schedule, runner, banners, admin console with overrides.
3. Targeted realtime + participant dashboard with challenge banners.
4. Submissions, public voting, judging.
5. Gateway: keys, budgets, logging first; degrade policy last, off by default.
6. Manual mini-game results entered by an admin, granting bonuses.
7. Load test with scripted clients; dress rehearsal 15 Oct; code freeze 13 Oct.

**Phase 1** — built-in mini-games, markets (play-money first), anti-cheat telemetry.
**Phase 2** — Higgsfield content tools, mentor marketplace, Spark bounty track, team formation.

## 9. Risks

| Risk | Mitigation |
|---|---|
| Live failures like the Sept 30 wheel | scheduled runner, idempotent actions, dress rehearsal, override console |
| Concurrent load online | load test; separate gateway; event-day scaling cap |
| Model provider rate limits and cost | per-team budgets, spend cap, request credits early |
| Gateway outage | fallback mode with team-owned keys |
| Multiple accounts / cheating | GitHub gating, audit log, finalist interview, live pitch |
| Real-money betting legality in Kazakhstan | play-money only until reviewed |
| Scope creep | feature flags; ship Phase 0 only |

## 10. Open decisions (Stephane, Mathis)

1. Hosting platform and monthly cap (Railway, Render, Fly.io, or a VPS).
2. Funding amounts from Superteam KZ and Spark; prize pool and incubation seats (NS sign-off).
3. Qualifier format and date; number of finalists (5–10).
4. Which AI tools are supported through the gateway at launch (one or two).
5. Whether the Spark pilot idea is the final's brief.
EOF
