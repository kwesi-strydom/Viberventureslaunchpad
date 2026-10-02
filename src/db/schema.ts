import {
  pgTable, serial, text, integer, timestamp, boolean, jsonb, uuid, bigserial, uniqueIndex, index,
} from "drizzle-orm/pg-core";

const now = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();

/** One row per person. GitHub is the only login for online accounts (no passwords). */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  githubId: text("github_id").notNull().unique(),
  handle: text("handle").notNull(),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  githubCreatedAt: timestamp("github_created_at", { withTimezone: true }), // account-age gating
  role: text("role").notNull().default("participant"), // participant | judge | admin
  status: text("status").notNull().default("active"), // active | banned
  createdAt: now(),
});

/** Session tokens are stored hashed; the raw token only lives in the user's cookie. */
export const sessions = pgTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: now(),
});

/** A competition. The clock fields mirror the live platform's row-locked manual timer. */
export const events = pgTable("events", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  mode: text("mode").notNull().default("online"), // online | live | hybrid
  status: text("status").notNull().default("draft"), // draft | open | running | ended
  startsAt: timestamp("starts_at", { withTimezone: true }),
  clockStatus: text("clock_status").notNull().default("idle"), // idle | running | paused | ended
  clockDurationSeconds: integer("clock_duration_seconds").notNull().default(3600),
  clockAccumulatedSeconds: integer("clock_accumulated_seconds").notNull().default(0),
  clockStartedAt: timestamp("clock_started_at", { withTimezone: true }),
  paused: boolean("paused").notNull().default(false), // global kill switch for the scheduler
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const teams = pgTable("teams", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  solo: boolean("solo").notNull().default(true),
  createdAt: now(),
});

export const participants = pgTable("participants", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  teamId: integer("team_id").references(() => teams.id, { onDelete: "set null" }),
  role: text("role").notNull().default("competitor"), // competitor | spectator
  stage: text("stage").notNull().default("qualifier"), // qualifier | finalist | eliminated
  createdAt: now(),
}, (t) => [uniqueIndex("participants_event_user").on(t.eventId, t.userId)]);

/** Planned challenges and bonuses. See docs/spec.md section 4. */
export const scheduleItems = pgTable("schedule_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: integer("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  atMode: text("at_mode").notNull(), // absolute | offset (seconds on the event clock)
  atTime: timestamp("at_time", { withTimezone: true }),
  offsetSeconds: integer("offset_seconds"),
  targetType: text("target_type").notNull(), // all | team | user | random | bottom
  targetValue: jsonb("target_value").notNull().default({}),
  effectType: text("effect_type").notNull(), // banner | degrade_model | cap_budget | inject_constraint | grant_bonus | minigame | response_required
  effectParams: jsonb("effect_params").notNull().default({}),
  durationSeconds: integer("duration_seconds"),
  announcement: text("announcement"),
  status: text("status").notNull().default("planned"), // planned | fired | skipped | cancelled | failed
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: now(),
}, (t) => [index("schedule_items_event_status").on(t.eventId, t.status)]);

/** One run per item (unique) so a restart or double fire can never apply an effect twice. */
export const scheduleRuns = pgTable("schedule_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  itemId: uuid("item_id").notNull().unique().references(() => scheduleItems.id, { onDelete: "cascade" }),
  firedAt: timestamp("fired_at", { withTimezone: true }).defaultNow().notNull(),
  firedBy: text("fired_by").notNull().default("scheduler"), // scheduler | operator
  outcome: text("outcome").notNull(), // ok | failed
  detail: jsonb("detail").notNull().default({}),
});

export const effectsActive = pgTable("effects_active", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: integer("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  itemId: uuid("item_id").references(() => scheduleItems.id, { onDelete: "set null" }),
  teamId: integer("team_id").references(() => teams.id, { onDelete: "cascade" }),
  participantId: integer("participant_id").references(() => participants.id, { onDelete: "cascade" }),
  effectType: text("effect_type").notNull(),
  params: jsonb("params").notNull().default({}),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (t) => [index("effects_active_event").on(t.eventId)]);

/** Append-only. Every advantage a team receives is a row here. */
export const bonusLedger = pgTable("bonus_ledger", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: integer("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  participantId: integer("participant_id").notNull().references(() => participants.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // time | tokens | model_upgrade | immunity | mentor_slot
  amount: integer("amount").notNull().default(0),
  reason: text("reason").notNull(),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: now(),
});

/** What the gateway enforces for a team right now. */
export const modelPolicies = pgTable("model_policies", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  teamId: integer("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  modelAlias: text("model_alias").notNull(),
  tokenBudget: integer("token_budget").notNull(),
  rateLimitPerMin: integer("rate_limit_per_min").notNull().default(30),
  validUntil: timestamp("valid_until", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex("model_policies_team").on(t.eventId, t.teamId)]);

export const submissions = pgTable("submissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: integer("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  teamId: integer("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  appUrl: text("app_url").notNull(),
  repoUrl: text("repo_url"),
  thumbnailUrl: text("thumbnail_url"),
  description: text("description"),
  createdAt: now(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex("submissions_event_team").on(t.eventId, t.teamId)]);

export const votes = pgTable("votes", {
  id: uuid("id").primaryKey().defaultRandom(),
  submissionId: uuid("submission_id").notNull().references(() => submissions.id, { onDelete: "cascade" }),
  voterId: uuid("voter_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  score: integer("score").notNull(), // 1..5, enforced in the API
  createdAt: now(),
}, (t) => [uniqueIndex("votes_submission_voter").on(t.submissionId, t.voterId)]);

export const auditLog = pgTable("audit_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  actorId: uuid("actor_id").references(() => users.id),
  action: text("action").notNull(),
  entity: text("entity"),
  detail: jsonb("detail").notNull().default({}),
  createdAt: now(),
});
