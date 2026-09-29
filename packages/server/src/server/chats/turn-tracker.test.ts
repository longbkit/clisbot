import { describe, expect, test } from "vitest";
import { createTestLogger } from "../../test-utils/test-logger.js";
import type {
  AgentManagerEvent,
  AgentSubscriber,
  ManagedAgent,
  SubscribeOptions,
} from "../agent/agent-manager.js";
import type { AgentStreamEvent, AgentTimelineItem } from "../agent/agent-sdk-types.js";
import { TurnTracker, type TurnOutcome } from "./turn-tracker.js";

function harness() {
  const subscribers = new Map<string, AgentSubscriber>();
  const subscribeOptions: SubscribeOptions[] = [];
  const completed: TurnOutcome[] = [];
  const failed: { outcome: TurnOutcome; error: string }[] = [];
  const unsubscribed: string[] = [];
  const tracker = new TurnTracker(
    {
      subscribe(callback, options) {
        subscribeOptions.push(options ?? {});
        subscribers.set(options?.agentId ?? "*", callback);
        return () => unsubscribed.push(options?.agentId ?? "*");
      },
    },
    {
      onTurnCompleted: async (outcome) => {
        completed.push(outcome);
      },
      onTurnFailed: async (outcome, error) => {
        failed.push({ outcome, error });
      },
    },
    createTestLogger(),
  );
  let seq = 0;
  const emit = (agentId: string, event: AgentStreamEvent, row = true) => {
    const managerEvent: AgentManagerEvent = {
      type: "agent_stream",
      agentId,
      event,
      ...(row ? { epoch: "epoch-1", seq: ++seq } : {}),
    };
    subscribers.get(agentId)?.(managerEvent);
  };
  const timeline = (agentId: string, item: AgentTimelineItem, turnId = "t1", row = true) =>
    emit(agentId, { type: "timeline", item, provider: "codex", turnId }, row);
  const assistant = (text: string, messageId?: string): AgentTimelineItem => ({
    type: "assistant_message",
    text,
    ...(messageId ? { messageId } : {}),
  });
  return {
    tracker,
    emit,
    timeline,
    assistant,
    completed,
    failed,
    unsubscribed,
    subscribeOptions,
    subscribers,
  };
}

describe("TurnTracker", () => {
  test("subscribes once per agent without replay and binds an expectation to the next turn", () => {
    const h = harness();
    h.tracker.watch("agent-1", "cht_1", "bot_a");
    h.tracker.watch("agent-1", "cht_1", "bot_a");
    expect(h.subscribeOptions).toEqual([{ agentId: "agent-1", replayState: false }]);

    h.tracker.expect("agent-1", { messageIds: ["m1"], hop: 0, disposition: "turn_started" });
    h.emit("agent-1", { type: "turn_started", provider: "codex", turnId: "t1" });
    h.timeline("agent-1", h.assistant("Hel", "a1"));
    h.timeline("agent-1", h.assistant("lo", "a1"));
    h.emit("agent-1", { type: "turn_completed", provider: "codex", turnId: "t1" });
    expect(h.completed).toEqual([
      {
        agentId: "agent-1",
        chatId: "cht_1",
        botId: "bot_a",
        turnId: "t1",
        text: "Hello",
        lastRow: { epoch: "epoch-1", seq: 3 },
        expectation: { messageIds: ["m1"], hop: 0, disposition: "turn_started" },
        // When turn_started arrived, so the chat can say how long the bot worked.
        startedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      },
    ]);
  });

  test("binds a synchronous complete turn before prompt admission resolves", async () => {
    const h = harness();
    h.tracker.watch("agent-1", "cht_1", "bot_a");
    await h.tracker.dispatch("agent-1", { messageIds: ["m1"], hop: 2 }, async () => {
      h.emit("agent-1", { type: "turn_started", provider: "codex", turnId: "t1" });
      h.timeline("agent-1", h.assistant("fast", "a1"));
      h.emit("agent-1", { type: "turn_completed", provider: "codex", turnId: "t1" });
      expect(h.completed).toHaveLength(0);
      return { disposition: "turn_started" };
    });
    expect(h.completed[0]).toMatchObject({
      text: "fast",
      expectation: { messageIds: ["m1"], hop: 2 },
    });
    h.emit("agent-1", { type: "turn_started", provider: "codex", turnId: "t2" });
    h.emit("agent-1", { type: "turn_completed", provider: "codex", turnId: "t2" });
    expect(h.completed[1]?.expectation).toBeNull();
  });

  test("keeps the last contiguous assistant run: a tool call resets it, messages join by id", () => {
    const h = harness();
    h.tracker.watch("agent-1", "cht_1", "bot_a");
    h.emit("agent-1", { type: "turn_started", provider: "codex", turnId: "t1" });
    h.timeline("agent-1", h.assistant("Let me look.", "a1"));
    h.timeline("agent-1", {
      type: "tool_call",
      callId: "call-1",
      name: "read",
      status: "completed",
      arguments: {},
    } as AgentTimelineItem);
    h.timeline("agent-1", h.assistant("[System Error] provider hiccup", "err"));
    h.timeline("agent-1", h.assistant("\n\n---\n\nFirst", "a2"));
    h.timeline("agent-1", h.assistant(" part", "a2"));
    h.timeline("agent-1", h.assistant("\n\n---\n\nSecond", "a3"));
    h.emit("agent-1", { type: "turn_completed", provider: "codex", turnId: "t1" });
    expect(h.completed[0]).toMatchObject({
      text: "First part\n\nSecond",
      lastRow: { epoch: "epoch-1", seq: 7 },
      expectation: null,
    });
  });

  test("an id-less stream accumulates as one message and reports no row without storage", () => {
    const h = harness();
    h.tracker.watch("agent-1", "cht_1", "bot_a");
    h.emit("agent-1", { type: "turn_started", provider: "codex", turnId: "t1" }, false);
    h.timeline("agent-1", h.assistant("a"), "t1", false);
    h.timeline("agent-1", h.assistant("b"), "t1", false);
    h.emit("agent-1", { type: "turn_completed", provider: "codex", turnId: "t1" }, false);
    expect(h.completed[0]).toMatchObject({ text: "ab", lastRow: null });
  });

  test("a failed turn reports its error with what it said; a canceled turn reports nothing", () => {
    const h = harness();
    h.tracker.watch("agent-1", "cht_1", "bot_a");
    h.tracker.expect("agent-1", { messageIds: ["m1"], hop: 0, disposition: "turn_started" });
    h.emit("agent-1", { type: "turn_started", provider: "codex", turnId: "t1" });
    h.timeline("agent-1", h.assistant("partial", "a1"));
    h.emit("agent-1", { type: "turn_failed", provider: "codex", error: "boom", turnId: "t1" });
    expect(h.failed).toEqual([
      {
        outcome: expect.objectContaining({
          turnId: "t1",
          text: "partial",
          expectation: expect.anything(),
        }),
        error: "boom",
      },
    ]);

    h.emit("agent-1", { type: "turn_started", provider: "codex", turnId: "t2" });
    h.timeline("agent-1", h.assistant("never mind", "a2"), "t2");
    h.emit("agent-1", { type: "turn_canceled", provider: "codex", reason: "user", turnId: "t2" });
    h.emit("agent-1", { type: "turn_completed", provider: "codex", turnId: "t2" });
    expect(h.completed).toEqual([]);
    expect(h.failed).toHaveLength(1);
  });

  test("expectations bind FIFO, a steer joins the open turn, out_of_band binds nothing", () => {
    const h = harness();
    h.tracker.watch("agent-1", "cht_1", "bot_a");
    h.tracker.expect("agent-1", { messageIds: ["m1"], hop: 0, disposition: "turn_started" });
    h.tracker.expect("agent-1", { messageIds: ["m2"], hop: 1, disposition: "turn_started" });
    h.tracker.expect("agent-1", { messageIds: ["dup"], hop: 0, disposition: "out_of_band" });
    h.emit("agent-1", { type: "turn_started", provider: "codex", turnId: "t1" });
    h.tracker.expect("agent-1", { messageIds: ["m3"], hop: 2, disposition: "steered" });
    h.timeline("agent-1", h.assistant("one", "a1"));
    h.emit("agent-1", { type: "turn_completed", provider: "codex", turnId: "t1" });
    h.emit("agent-1", { type: "turn_started", provider: "codex", turnId: "t2" });
    h.timeline("agent-1", h.assistant("two", "a2"), "t2");
    h.emit("agent-1", { type: "turn_completed", provider: "codex", turnId: "t2" });
    h.emit("agent-1", { type: "turn_started", provider: "codex", turnId: "t3" });
    h.emit("agent-1", { type: "turn_completed", provider: "codex", turnId: "t3" });
    expect(
      h.completed.map((outcome) => [outcome.turnId, outcome.text, outcome.expectation]),
    ).toEqual([
      ["t1", "one", { messageIds: ["m1", "m3"], hop: 2, disposition: "turn_started" }],
      ["t2", "two", { messageIds: ["m2"], hop: 1, disposition: "turn_started" }],
      ["t3", null, null],
    ]);
  });

  test("a closed agent drops its subscription; the next watch subscribes again", () => {
    const h = harness();
    h.tracker.watch("agent-1", "cht_1", "bot_a");
    h.subscribers.get("agent-1")?.({
      type: "agent_state",
      agent: { id: "agent-1", lifecycle: "closed" } as ManagedAgent,
    });
    expect(h.unsubscribed).toEqual(["agent-1"]);
    h.tracker.watch("agent-1", "cht_1", "bot_a");
    expect(h.subscribeOptions).toHaveLength(2);
    h.tracker.stop();
    expect(h.unsubscribed).toEqual(["agent-1", "agent-1"]);
  });
});
