import { test } from "node:test";
import assert from "node:assert/strict";
import { clockUpdates, elapsedSeconds, ClockInputError, type Clock } from "./clock.ts";
import { dueItems, isDue, type ScheduleItemLite } from "./schedule.ts";

const t0 = new Date("2026-10-16T14:00:00Z");
const at = (s: number) => new Date(t0.getTime() + s * 1000);
const idle: Clock = { status: "idle", durationSeconds: 3600, accumulatedSeconds: 0, startedAt: null };

test("clock: start, stop and resume accumulate elapsed time", () => {
  const started = { ...idle, ...clockUpdates(idle, { action: "start" }, t0) } as Clock;
  assert.equal(started.status, "running");
  assert.equal(elapsedSeconds(started, at(90)), 90);
  const stopped = { ...started, ...clockUpdates(started, { action: "stop" }, at(90)) } as Clock;
  assert.equal(stopped.status, "paused");
  assert.equal(elapsedSeconds(stopped, at(500)), 90); // frozen while paused
  const resumed = { ...stopped, ...clockUpdates(stopped, { action: "start" }, at(500)) } as Clock;
  assert.equal(elapsedSeconds(resumed, at(530)), 120);
});

test("clock: elapsed never exceeds the duration", () => {
  const running: Clock = { status: "running", durationSeconds: 600, accumulatedSeconds: 0, startedAt: t0 };
  assert.equal(elapsedSeconds(running, at(99999)), 600);
});

test("clock: starting a running clock or stopping an idle one changes nothing", () => {
  const running: Clock = { ...idle, status: "running", startedAt: t0 };
  assert.deepEqual(clockUpdates(running, { action: "start" }, at(5)), {});
  assert.deepEqual(clockUpdates(idle, { action: "stop" }, at(5)), {});
});

test("clock: rejects bad input", () => {
  assert.throws(() => clockUpdates(idle, null), ClockInputError);
  assert.throws(() => clockUpdates(idle, { action: "explode" }), ClockInputError);
  assert.throws(() => clockUpdates(idle, { action: "set-duration", durationSeconds: 90 }), ClockInputError);
  assert.throws(() => clockUpdates(idle, { action: "set-duration", durationSeconds: 0 }), ClockInputError);
  assert.deepEqual(clockUpdates(idle, { action: "set-duration", durationSeconds: 600 }), { durationSeconds: 600 });
});

const running: Clock = { status: "running", durationSeconds: 3600, accumulatedSeconds: 0, startedAt: t0 };
const item = (over: Partial<ScheduleItemLite>): ScheduleItemLite => ({
  id: "x", status: "planned", atMode: "offset", atTime: null, offsetSeconds: 600, ...over,
});

test("schedule: offset items fire only after the clock reaches them", () => {
  const ev = { paused: false, clock: running };
  assert.equal(isDue(item({}), ev, at(599)), false);
  assert.equal(isDue(item({}), ev, at(600)), true);
});

test("schedule: offset items never fire while the clock is not running", () => {
  const paused: Clock = { ...running, status: "paused", accumulatedSeconds: 5000, startedAt: null };
  assert.equal(isDue(item({}), { paused: false, clock: paused }, at(9999)), false);
  assert.equal(isDue(item({}), { paused: false, clock: idle }, at(9999)), false);
});

test("schedule: absolute items fire at their time", () => {
  const ev = { paused: false, clock: idle };
  const it = item({ atMode: "absolute", atTime: at(100), offsetSeconds: null });
  assert.equal(isDue(it, ev, at(99)), false);
  assert.equal(isDue(it, ev, at(100)), true);
});

test("schedule: kill switch and non-planned statuses block firing", () => {
  assert.equal(isDue(item({}), { paused: true, clock: running }, at(900)), false);
  for (const status of ["fired", "skipped", "cancelled", "failed"]) {
    assert.equal(isDue(item({ status }), { paused: false, clock: running }, at(900)), false);
  }
});

test("schedule: due items replay in scheduled order", () => {
  const ev = { paused: false, clock: running };
  const items = [item({ id: "b", offsetSeconds: 300 }), item({ id: "a", offsetSeconds: 100 }), item({ id: "c", offsetSeconds: 5000 })];
  assert.deepEqual(dueItems(items, ev, at(400)).map((i) => i.id), ["a", "b"]);
});
