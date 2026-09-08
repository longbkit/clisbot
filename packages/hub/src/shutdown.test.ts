// COMPAT(clisbot-control-plane): the shutdown orchestration (D-W4-05). Driven
// with fakes for every path a live SIGTERM can take — the order, the budget,
// the throwing step, and the second signal.
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  createSignalShutdown,
  type ShutdownOptions,
  type ShutdownSchedule,
  type ShutdownStep,
} from "./shutdown.js";

const SILENT: NonNullable<ShutdownOptions["logger"]> = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
} as NonNullable<ShutdownOptions["logger"]>;

interface FakeTimer {
  ms: number;
  fire(): void;
  cancelled: boolean;
}

function fakeSchedule(): { timers: FakeTimer[]; schedule: ShutdownSchedule } {
  const timers: FakeTimer[] = [];
  const schedule: ShutdownSchedule = (ms, onElapsed) => {
    const timer: FakeTimer = { ms, fire: onElapsed, cancelled: false };
    timers.push(timer);
    return () => {
      timer.cancelled = true;
    };
  };
  return { timers, schedule };
}

/** Fire the first live timer of the given duration. */
function fire(timers: FakeTimer[], ms: number): void {
  const timer = timers.find((candidate) => candidate.ms === ms && !candidate.cancelled);
  assert.ok(timer !== undefined, `no live timer scheduled for ${ms}ms`);
  timer.fire();
}

function step(name: string, run: () => Promise<void>): ShutdownStep {
  return { name, run };
}

/** An exit recorder that also lets a test await the exit. */
function exitRecorder(): {
  codes: number[];
  exit: (code: number) => void;
  reached(): Promise<number>;
} {
  const codes: number[] = [];
  let announce: ((code: number) => void) | undefined;
  return {
    codes,
    exit: (code) => {
      codes.push(code);
      announce?.(code);
    },
    reached: () =>
      new Promise<number>((resolve) => {
        if (codes.length > 0) {
          resolve(codes[0]!);
          return;
        }
        announce = resolve;
      }),
  };
}

describe("createSignalShutdown", () => {
  it("stops admission before tearing the links down, then releases", async () => {
    const order: string[] = [];
    const exit = exitRecorder();
    const { schedule } = fakeSchedule();
    const handle = createSignalShutdown({
      sequence: {
        steps: [
          step("runtime", async () => {
            order.push("runtime");
          }),
          step("listener", async () => {
            order.push("listener");
          }),
        ],
        release: async () => {
          order.push("release");
        },
      },
      exit: exit.exit,
      schedule,
      logger: SILENT,
    });

    handle("SIGTERM");
    assert.equal(await exit.reached(), 0);
    assert.deepEqual(order, ["runtime", "listener", "release"]);
    assert.deepEqual(exit.codes, [0], "the process exits exactly once");
  });

  it("exits after the budget even when a step never finishes", async () => {
    const order: string[] = [];
    const exit = exitRecorder();
    const { timers, schedule } = fakeSchedule();
    const handle = createSignalShutdown({
      sequence: {
        steps: [
          step("runtime", () => {
            order.push("runtime");
            // The live failure: the stop never resolves.
            return new Promise<void>(() => undefined);
          }),
          step("listener", async () => {
            order.push("listener");
          }),
        ],
        release: async () => {
          order.push("release");
        },
      },
      exit: exit.exit,
      budgetMs: 20_000,
      schedule,
      logger: SILENT,
    });

    handle("SIGTERM");
    await Promise.resolve();
    assert.deepEqual(exit.codes, [], "nothing exits before the budget elapses");
    fire(timers, 20_000);
    assert.equal(await exit.reached(), 1);
    assert.deepEqual(
      order,
      ["runtime", "release"],
      "the hung step is abandoned and the release still runs",
    );
  });

  it("releases the exclusive resources when a step throws", async () => {
    const order: string[] = [];
    const exit = exitRecorder();
    const { schedule } = fakeSchedule();
    const handle = createSignalShutdown({
      sequence: {
        steps: [
          step("runtime", () => {
            order.push("runtime");
            return Promise.reject(new Error("runtime stop failed"));
          }),
          step("listener", async () => {
            order.push("listener");
          }),
        ],
        release: async () => {
          order.push("release");
        },
      },
      exit: exit.exit,
      schedule,
      logger: SILENT,
    });

    handle("SIGTERM");
    assert.equal(await exit.reached(), 1);
    assert.deepEqual(
      order,
      ["runtime", "release"],
      "a thrown step stops the sequence but never skips the release",
    );
  });

  it("exits immediately on a second signal", async () => {
    const exit = exitRecorder();
    const { schedule } = fakeSchedule();
    const handle = createSignalShutdown({
      sequence: {
        steps: [step("runtime", () => new Promise<void>(() => undefined))],
        release: async () => undefined,
      },
      exit: exit.exit,
      schedule,
      logger: SILENT,
    });

    handle("SIGTERM");
    await Promise.resolve();
    assert.deepEqual(exit.codes, []);
    handle("SIGTERM");
    assert.deepEqual(exit.codes, [1], "the repeat signal exits synchronously");
  });

  it("exits anyway when the release itself hangs", async () => {
    const exit = exitRecorder();
    const { timers, schedule } = fakeSchedule();
    const handle = createSignalShutdown({
      sequence: {
        steps: [step("runtime", async () => undefined)],
        release: () => new Promise<void>(() => undefined),
      },
      exit: exit.exit,
      releaseGraceMs: 2_000,
      schedule,
      logger: SILENT,
    });

    handle("SIGTERM");
    await Promise.resolve();
    await Promise.resolve();
    fire(timers, 2_000);
    assert.equal(await exit.reached(), 1);
  });
});
