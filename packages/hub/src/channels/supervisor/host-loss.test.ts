// A dropped daemon socket is routine: the client reconnects on its own. The
// notice (and the turn-end it carries) has to wait for the grace, or a
// two-second flap tells every conversation the machine went away and releases
// messages held behind turns that are still running.
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { HostLossNotifier } from "./host-loss.js";

/** Timers the test runs by hand. */
function fakeTimers() {
  const pending = new Map<number, () => void>();
  let next = 0;
  return {
    setTimer: (run: () => void) => {
      next += 1;
      pending.set(next, run);
      return next;
    },
    clearTimer: (timer: unknown) => {
      pending.delete(timer as number);
    },
    /** Run every armed timer, as the grace elapsing. */
    elapse: () => {
      for (const [id, run] of Array.from(pending)) {
        pending.delete(id);
        run();
      }
    },
    get armed() {
      return pending.size;
    },
  };
}

function notifier(timers: ReturnType<typeof fakeTimers>) {
  const notices: number[] = [];
  const subject = new HostLossNotifier({
    graceMs: 5_000,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    notify: async () => {
      notices.push(notices.length + 1);
    },
  });
  return { subject, notices };
}

describe("host-loss notifier", () => {
  it("says nothing when the socket comes back inside the grace", () => {
    const timers = fakeTimers();
    const { subject, notices } = notifier(timers);
    subject.disconnected();
    subject.connected();
    timers.elapse();
    assert.deepEqual(notices, [], "a flap is not the Host going away");
    assert.equal(timers.armed, 0, "and nothing is left armed");
  });

  it("tells the conversations when the socket stays down past the grace", () => {
    const timers = fakeTimers();
    const { subject, notices } = notifier(timers);
    subject.disconnected();
    timers.elapse();
    assert.deepEqual(notices, [1]);
  });

  it("reports one disconnection once, however many drops it reports", () => {
    const timers = fakeTimers();
    const { subject, notices } = notifier(timers);
    subject.disconnected();
    subject.disconnected();
    timers.elapse();
    subject.disconnected();
    timers.elapse();
    assert.deepEqual(notices, [1], "not repeated while the socket is still down");
    // Back up, then down again: that is a new disconnection.
    subject.connected();
    subject.disconnected();
    timers.elapse();
    assert.deepEqual(notices, [1, 2]);
  });

  it("drops the armed grace when the account stops", () => {
    const timers = fakeTimers();
    const { subject, notices } = notifier(timers);
    subject.disconnected();
    subject.stop();
    timers.elapse();
    assert.deepEqual(notices, []);
  });
});
