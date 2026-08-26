// The clock seam for the execution plane (idle TTL, progress throttle). Tests
// drive `ManualClock` so no real timer runs on the happy path; the live plane
// uses `realClock()`. Keeping the clock behind a `now()` interface is what lets
// the idle-TTL and throttle tests advance time without waiting.

import type { PlaneClock } from "./types.js";

/** The production clock. */
export function realClock(): PlaneClock {
  return { now: () => Date.now() };
}

/** A hand-advanced clock for tests. */
export class ManualClock implements PlaneClock {
  private current: number;

  constructor(startMs = 0) {
    this.current = startMs;
  }

  now(): number {
    return this.current;
  }

  /** Advance the clock by `ms` (used to simulate idle time passing). */
  advance(ms: number): void {
    this.current += ms;
  }

  /** Set the clock to an absolute value. */
  set(ms: number): void {
    this.current = ms;
  }
}
