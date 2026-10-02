/**
 * Which schedule items should fire right now? Pure decision logic.
 * The runner (next step) calls this, then fires each item inside a transaction
 * guarded by the unique schedule_runs.item_id, so a double tick cannot apply twice.
 */
import { elapsedSeconds, type Clock } from "./clock.ts";

export interface ScheduleItemLite {
  id: string;
  status: string; // planned | fired | skipped | cancelled | failed
  atMode: "absolute" | "offset";
  atTime: Date | null;
  offsetSeconds: number | null;
}

export interface EventLite {
  paused: boolean; // kill switch
  clock: Clock;
}

export function isDue(item: ScheduleItemLite, event: EventLite, now = new Date()): boolean {
  if (item.status !== "planned" || event.paused) return false;
  if (item.atMode === "absolute") {
    return item.atTime !== null && item.atTime.getTime() <= now.getTime();
  }
  // Offset items only fire while the event clock is actually running.
  if (event.clock.status !== "running" || item.offsetSeconds === null) return false;
  return item.offsetSeconds <= elapsedSeconds(event.clock, now);
}

/** Due items, oldest scheduled first, so a late runner replays in order. */
export function dueItems<T extends ScheduleItemLite>(items: T[], event: EventLite, now = new Date()): T[] {
  const key = (i: T) => (i.atMode === "absolute" ? (i.atTime?.getTime() ?? 0) : (i.offsetSeconds ?? 0) * 1000);
  return items.filter((i) => isDue(i, event, now)).sort((a, b) => key(a) - key(b));
}
