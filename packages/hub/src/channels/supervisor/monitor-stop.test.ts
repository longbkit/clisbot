// The teardown's bounded wait on a vertical's gateway. The timer is a seam so
// the grace is asserted without spending it.
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { awaitMonitorExit, MONITOR_STOP_GRACE_MS } from "./monitor-stop.js";

/** A schedule whose timer only fires when the test says so. */
function manualSchedule() {
  const scheduled: number[] = [];
  let cancelled = 0;
  let fire: (() => void) | undefined;
  return {
    scheduled,
    cancelled: () => cancelled,
    elapse: () => fire?.(),
    schedule: (ms: number, onElapsed: () => void) => {
      scheduled.push(ms);
      fire = onElapsed;
      return () => {
        cancelled += 1;
      };
    },
  };
}

describe("channel account monitor stop", () => {
  it("waits for a monitor that returns, and cancels the grace timer", async () => {
    const timer = manualSchedule();
    const lingering: number[] = [];
    const settled = await awaitMonitorExit(Promise.resolve(), {
      schedule: timer.schedule,
      onLingering: () => lingering.push(1),
    });
    assert.equal(settled, true);
    assert.deepEqual(timer.scheduled, [MONITOR_STOP_GRACE_MS]);
    assert.equal(timer.cancelled(), 1);
    assert.deepEqual(lingering, []);
  });

  // The whole point: an account whose socket ignores the abort used to hang the
  // stop, and the Hub's shutdown watchdog killed the process instead.
  it("gives up on a monitor that never returns, and says so once", async () => {
    const timer = manualSchedule();
    let lingering = 0;
    const never = new Promise<void>(() => undefined);
    const waiting = awaitMonitorExit(never, {
      graceMs: 25,
      schedule: timer.schedule,
      onLingering: () => {
        lingering += 1;
      },
    });
    assert.deepEqual(timer.scheduled, [25]);
    timer.elapse();
    assert.equal(await waiting, false);
    assert.equal(lingering, 1);
  });

  it("treats an account with no monitor as already stopped", async () => {
    const timer = manualSchedule();
    assert.equal(await awaitMonitorExit(undefined, { schedule: timer.schedule }), true);
    assert.deepEqual(timer.scheduled, []);
  });
});
