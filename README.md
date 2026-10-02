# Viber Online Launchpad

The online and hybrid platform for the Viber vibecoding competition series.

This is a **separate project** from the live-event Launchpad
(`kwesi-strydom/viberventures`). It has its own repo, its own database
and its own deployment, so online accounts and traffic can never affect
live-event data.

## What it does

- Runs a vibecoding competition where hundreds of people can take part online
  while a smaller group competes live (at Network School Astana).
- Delivers the "founder-life" challenges (pivot, server crash, funding pulled,
  lawsuit, ...) and bonus events to every participant automatically, on a schedule,
  with an operator override.
- Gates entry (one verified account per person) and can control each team's AI
  model access through a gateway, so challenges such as "server crash" are real.
- Collects submissions, audience voting and judging, and feeds the results to
  Network School and Spark follow-ups.

See [docs/spec.md](docs/spec.md) for the architecture, schema and build order.

## Status

Scaffold in progress (schema, event clock, scheduler logic, health endpoint). First target event: **Fri 16 Oct 2026** (online qualifier the week before).

## Neon database setup (run on your own computer)

Neon is not reachable from Claude's cloud container, so run these in a terminal
inside this repo on your own machine:

```bash
npm i -g neon@latest
neon login
neon skills -y
neon mcp -y
neon link --project-id square-firefly-44432460 --branch production -y
neon config init     # if it asks to overwrite neon.ts, keep the version in this repo
npm install          # installs @neon/config
neon deploy
```

`neon.ts` is already in the repo with an empty config (`defineConfig({})`).
Never commit database URLs or API keys. Use `.env` locally (it is git-ignored).

## Running it locally

```bash
git pull
npm install
npm test            # engine unit tests, no database needed
npm run check       # typecheck
npm run db:migrate  # applies drizzle/*.sql to the Neon branch in .env.local
npm run dev         # http://localhost:5001/api/health
```

`.env.local` holds your database URLs and is git-ignored. Use a **Neon dev branch** for
experiments, not `production`, once real participants exist.

## Layout

- `src/db/schema.ts`: all tables (see docs/spec.md section 5)
- `src/engine/clock.ts`, `schedule.ts`: event clock and "what is due now" logic, with tests
- `src/server/`: Express app (health check only so far)
- `drizzle/`: generated SQL migrations. Review them before applying.
