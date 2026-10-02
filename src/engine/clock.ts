/**
 * Event clock, ported in spirit from the live platform's manual timer
 * (kwesi-strydom/viberventures, server/dashboard-timer.ts): pure functions,
 * so they are easy to test and the database layer only has to lock the row.
 */
export const MAX_TIMER_SECONDS = 7 * 24 * 60 * 60;

export type ClockStatus = "idle" | "running" | "paused" | "ended";

export interface Clock {
  status: ClockStatus;
  durationSeconds: number;
  accumulatedSeconds: number;
  startedAt: Date | null;
}

export class ClockInputError extends Error {}

export function elapsedSeconds(clock: Clock, now = new Date()): number {
  const running = clock.status === "running" && clock.startedAt
    ? Math.max(0, Math.floor((now.getTime() - clock.startedAt.getTime()) / 1000))
    : 0;
  return Math.max(0, Math.min(clock.durationSeconds, clock.accumulatedSeconds + running));
}

export type ClockAction =
  | { action: "start" }
  | { action: "stop" }
  | { action: "reset" }
  | { action: "set-duration"; durationSeconds: number };

/** Returns only the fields that change; an empty object means "no change". */
export function clockUpdates(clock: Clock, input: unknown, now = new Date()): Partial<Clock> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ClockInputError("Choose a clock action.");
  }
  const body = input as Record<string, unknown>;
  switch (body.action) {
    case "start":
      return clock.status === "running" ? {} : { status: "running", startedAt: now };
    case "stop":
      return clock.status !== "running"
        ? {}
        : { status: "paused", accumulatedSeconds: elapsedSeconds(clock, now), startedAt: null };
    case "reset":
      return { status: "idle", accumulatedSeconds: 0, startedAt: null };
    case "set-duration": {
      const d = body.durationSeconds;
      if (typeof d !== "number" || !Number.isInteger(d) || d < 60 || d > MAX_TIMER_SECONDS || d % 60 !== 0) {
        throw new ClockInputError("Enter a whole number of minutes between 1 and 10,080.");
      }
      return { durationSeconds: d };
    }
    default:
      throw new ClockInputError("Unknown clock action. Use start, stop, reset or set-duration.");
  }
}
