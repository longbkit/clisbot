// The processing lease: who opens it, who closes it, and what a shared surface
// costs. These are the invariants the indicator's VISIBILITY depends on — the
// bug this replaces was a surface opened on `turn_started`, an event the plane
// cannot reliably observe because it sends the prompt before subscribing.
import { describe, expect, it } from "vitest";
import type { EffectiveDefaults } from "../config/compile.js";
import {
  createProcessingController,
  processingSurfaceFor,
  type ProcessingControllerDeps,
  type ProcessingSurface,
} from "./processing.js";
import type { PlaneLogger, TypingParams } from "./types.js";

interface Harness {
  calls: TypingParams[];
  now: { value: number };
  ticks: (() => void)[];
  controller: ReturnType<typeof createProcessingController>;
}

function harness(
  overrides: Partial<ProcessingControllerDeps> & { ttlMs?: number } = {},
  driveImpl?: (params: TypingParams) => Promise<void>,
): Harness {
  const calls: TypingParams[] = [];
  const now = { value: 1_000 };
  const ticks: (() => void)[] = [];
  const logger: PlaneLogger = { warn: () => undefined };
  const controller = createProcessingController({
    logger,
    now: () => now.value,
    schedule: (tick) => {
      ticks.push(tick);
      return () => undefined;
    },
    drive:
      driveImpl ??
      (async (params) => {
        calls.push(params);
      }),
    ...overrides,
  });
  return { calls, now, ticks, controller };
}

/** Let the controller’s fire-and-forget drive promise settle. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
};

const SURFACE: ProcessingSurface = {
  channel: "slack",
  accountId: "work",
  to: "C1",
  threadId: "1700.0001",
  messageId: "1700.0000",
  indicator: true,
};

describe("processingSurfaceFor", () => {
  const sync = (over: Partial<EffectiveDefaults["sync"]>) =>
    ({
      finalAnswers: true,
      progress: { progressMessage: true, typingIndicator: true, messageReaction: "off" },
      toolCalls: false,
      threadLink: "full",
      subagents: { finalAnswers: false, progress: false, toolCalls: false },
      ...over,
    }) as EffectiveDefaults["sync"];

  it("is undefined when both liveness leaves are off", () => {
    expect(
      processingSurfaceFor({
        channel: "slack",
        accountId: "work",
        sync: sync({
          progress: { progressMessage: true, typingIndicator: false, messageReaction: "off" },
        }),
        to: "C1",
      }),
    ).toBeUndefined();
  });

  it("carries the reaction name and folds the reserved off", () => {
    const surface = processingSurfaceFor({
      channel: "slack",
      accountId: "work",
      sync: sync({
        progress: {
          progressMessage: false,
          typingIndicator: false,
          messageReaction: "hourglass_flowing_sand",
        },
      }),
      to: "C1",
      messageId: "1700.0000",
    });
    expect(surface).toBeDefined();
    expect(surface?.indicator).toBe(false);
    expect(surface?.reactionEmoji).toBe("hourglass_flowing_sand");
  });
});

describe("createProcessingController", () => {
  it("drives start once when a turn is opened", () => {
    const h = harness();
    h.controller.open("a", SURFACE);
    expect(h.calls).toEqual([
      {
        channel: "slack",
        accountId: "work",
        to: "C1",
        action: "start",
        indicator: true,
        threadId: "1700.0001",
        messageId: "1700.0000",
      },
    ]);
  });

  it("is idempotent per lease id", () => {
    const h = harness();
    h.controller.open("a", SURFACE);
    h.controller.open("a", SURFACE);
    expect(h.calls).toHaveLength(1);
  });

  it("shares one surface between concurrent turns and closes it only for the last", () => {
    const h = harness();
    h.controller.open("a", SURFACE);
    h.controller.open("b", { ...SURFACE, messageId: "1700.0009" });
    // One indicator per conversation+thread, not per turn.
    expect(h.calls.filter((c) => c.action === "start")).toHaveLength(1);

    h.controller.close("a");
    expect(h.calls.filter((c) => c.action === "stop")).toHaveLength(0);

    h.controller.close("b");
    const stops = h.calls.filter((c) => c.action === "stop");
    expect(stops).toHaveLength(1);
    // The stop carries the surviving lease's own marker, not the first one's.
    expect(stops[0]?.messageId).toBeDefined();
  });

  it("binds a provisional lease to its agent and closes it on the terminal event", () => {
    const h = harness();
    h.controller.open("exec-1", SURFACE);
    h.controller.bind("exec-1", "agent-9");
    h.controller.closeAgent("agent-9");
    expect(h.calls.map((c) => c.action)).toEqual(["start", "stop"]);
  });

  it("closes every lease an agent holds when its turn ends", () => {
    // A follow-up steered into a running turn is a second lease on the SAME
    // agent and surface. The terminal event ends both: neither may leak an
    // indicator the relay will never be told to clear.
    const h = harness();
    h.controller.open("exec-1", SURFACE);
    h.controller.bind("exec-1", "agent-9");
    h.controller.open("exec-2", { ...SURFACE, messageId: "1700.0009" });
    h.controller.bind("exec-2", "agent-9");
    expect(h.calls.filter((c) => c.action === "start")).toHaveLength(1);

    h.controller.closeAgent("agent-9");
    expect(h.calls.map((c) => c.action)).toEqual(["start", "stop"]);
    // Nothing left to close a second time.
    h.controller.closeAgent("agent-9");
    expect(h.calls).toHaveLength(2);
  });

  it("a stream event keeps every lease of the agent alive", () => {
    const h = harness({ ttlMs: 10_000 });
    h.controller.open("exec-1", SURFACE);
    h.controller.open("exec-2", { ...SURFACE, messageId: "1700.0009" });
    h.controller.bind("exec-1", "agent-9");
    h.controller.bind("exec-2", "agent-9");
    h.now.value += 6_000;
    h.controller.touch("agent-9");
    h.now.value += 6_000;
    h.ticks[h.ticks.length - 1]?.();
    expect(h.calls).toHaveLength(1);
    h.now.value += 10_001;
    h.ticks[h.ticks.length - 1]?.();
    expect(h.calls.map((c) => c.action)).toEqual(["start", "stop"]);
  });

  it("keeps the surface alive on stream events and releases a stalled turn", () => {
    const h = harness({ ttlMs: 60_000 });
    h.controller.open("exec-1", { ...SURFACE });
    h.controller.bind("exec-1", "agent-9");
    const warns: string[] = [];
    // Re-open with a logger that records, to observe the timeout.
    const logged = createProcessingController({
      logger: { warn: (m) => warns.push(m) },
      now: () => h.now.value,
      schedule: (tick) => {
        h.ticks.push(tick);
        return () => undefined;
      },
      drive: async () => undefined,
      ttlMs: 60_000,
    });
    logged.open("x", SURFACE);
    logged.bind("x", "agent-1");
    h.now.value += 30_000;
    logged.touch("agent-1");
    h.ticks[h.ticks.length - 1]?.();
    expect(warns).toEqual([]);

    h.now.value += 60_001;
    h.ticks[h.ticks.length - 1]?.();
    expect(warns).toEqual(["channel processing surface timed out"]);
  });

  it("logs and releases the surface when the drive fails, never throwing", async () => {
    const warns: Array<Record<string, unknown>> = [];
    const calls: TypingParams[] = [];
    const controller = createProcessingController({
      logger: {
        warn: (_m, meta) => warns.push(meta as Record<string, unknown>),
      },
      now: () => 1_000,
      schedule: () => () => undefined,
      drive: async (params) => {
        calls.push(params);
        if (params.action === "start") throw new Error("not_in_channel");
      },
    });

    controller.open("a", SURFACE);
    await settle();
    // The fault is reported once with its context, and the lease is gone — so
    // a provider that refuses the call is not retried every event.
    expect(warns).toHaveLength(1);
    expect(warns[0]).toMatchObject({ action: "start", to: "C1" });
    controller.close("a");
    await settle();
    expect(calls.filter((c) => c.action === "stop")).toHaveLength(0);

    // A fresh inbound may try again.
    controller.open("b", SURFACE);
    await settle();
    expect(calls.filter((c) => c.action === "start")).toHaveLength(2);
  });
  it("stops every surface on plane shutdown", () => {
    const h = harness();
    h.controller.open("a", SURFACE);
    h.controller.open("b", { ...SURFACE, to: "C2" });
    h.controller.stopAll();
    expect(h.calls.filter((c) => c.action === "stop").map((c) => c.to)).toEqual(["C1", "C2"]);
  });

  it("does nothing at all without a drive", () => {
    const h = harness({ drive: undefined });
    h.controller.open("a", SURFACE);
    h.controller.close("a");
    expect(h.calls).toEqual([]);
  });
});

it("keeps quiet tools visible only while a fresh daemon query confirms their Agent is running", async () => {
  let running = new Set(["agent"]);
  const h = harness({ ttlMs: 1000, readRunningAgentIds: async () => running });
  h.controller.open("lease", SURFACE);
  h.controller.bind("lease", "agent");
  for (let i = 0; i < 3; i += 1) {
    h.now.value += 1001;
    h.ticks[0]!();
    await settle();
    expect(h.calls.map((call) => call.action)).toEqual(["start"]);
  }
  running = new Set();
  h.now.value += 1001;
  h.ticks[0]!();
  await settle();
  expect(h.calls.map((call) => call.action)).toEqual(["start", "stop"]);
});

it("expires quiet turns when daemon authority cannot be read", async () => {
  const h = harness({
    ttlMs: 1000,
    readRunningAgentIds: async () => {
      throw new Error("disconnected");
    },
  });
  h.controller.open("lease", SURFACE);
  h.controller.bind("lease", "agent");
  h.now.value += 1001;
  h.ticks[0]!();
  await settle();
  expect(h.calls.map((call) => call.action)).toEqual(["start", "stop"]);
});

it("does not resurrect a terminal lease when its pending daemon query resolves", async () => {
  let resolve!: (running: Set<string>) => void;
  const running = new Promise<Set<string>>((yes) => {
    resolve = yes;
  });
  const h = harness({ ttlMs: 1000, readRunningAgentIds: () => running });
  h.controller.open("lease", SURFACE);
  h.controller.bind("lease", "agent");
  h.now.value += 1001;
  h.ticks[0]!();
  h.controller.closeAgent("agent");
  resolve(new Set(["agent"]));
  await settle();
  h.now.value += 1001;
  h.ticks[0]!();
  await settle();
  expect(h.calls.map((call) => call.action)).toEqual(["start", "stop"]);
});
