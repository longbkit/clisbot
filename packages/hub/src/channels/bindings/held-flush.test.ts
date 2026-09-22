// The flush timing, apart from the plane: when held messages fall due, and
// that the scheduler admits exactly one flush row per newest held message. The
// inbox is a fake here; the plane-level tests drive the real one
// (`execution/conversation-flow.test.ts`).
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { ChannelInboxStore } from "../../db/channel-inbox.js";
import type { ChannelIngressQueueRecord } from "../../db/types.js";
import { conversationSettings } from "../config/conversation.js";
import {
  BUSY_HOLD_MAX_MS,
  HELD_FLUSH_KIND,
  HeldFlushScheduler,
  heldDueAt,
  type HeldFlushAdmission,
} from "./held-flush.js";
import { BindingInbox, inboxBindingKey } from "./inbox.js";

const WINDOW = { pauseSeconds: 3, maxWaitSeconds: 10, maxMessages: 4 };
const BATCHING = conversationSettings({ batching: WINDOW });
const QUEUE = conversationSettings({ whenBusy: "queue" });

describe("heldDueAt", () => {
  it("waits for a pause after the newest message", () => {
    assert.equal(heldDueAt([1_000, 2_000], BATCHING, false), 5_000);
  });

  it("sends once the first message has waited maxWaitSeconds, however busy the burst", () => {
    assert.equal(heldDueAt([0, 3_000, 6_000], BATCHING, false), 9_000, "still the pause");
    assert.equal(heldDueAt([0, 8_000, 9_000], BATCHING, false), 10_000, "maxWait cuts it short");
  });

  it("sends at maxMessages without waiting", () => {
    assert.equal(heldDueAt([1_000, 1_100, 1_200, 1_300], BATCHING, false), 1_000);
  });

  it("holds a queued message until the turn ends, bounded", () => {
    assert.equal(heldDueAt([1_000], QUEUE, true), 1_000 + BUSY_HOLD_MAX_MS);
    assert.equal(heldDueAt([1_000], QUEUE, false), 1_000);
    // A steering Route ignores the running turn; only its batch holds.
    assert.equal(heldDueAt([1_000], BATCHING, true), 4_000);
  });

  it("has nothing to send without held messages", () => {
    assert.equal(heldDueAt([], BATCHING, false), undefined);
  });
});

function row(id: string, createdAt: number): ChannelIngressQueueRecord {
  return { id, createdAt: new Date(createdAt), laneKey: "lane-1" } as ChannelIngressQueueRecord;
}

function schedulerHarness(held: ChannelIngressQueueRecord[], now: { value: number }) {
  const store = {
    list: async () => held,
    listHeldBindings: async () => (held.length === 0 ? [] : [SCOPE.bindingKey]),
  } as unknown as ChannelInboxStore;
  const inbox = new BindingInbox({ store, organizationId: "org", readMessage: () => null });
  const timers: { delayMs: number; fire: () => void }[] = [];
  const admitted: HeldFlushAdmission[] = [];
  const running = new Set<string>();
  const scheduler = new HeldFlushScheduler({
    inbox,
    now: () => now.value,
    isTurnRunning: (agentId) => running.has(agentId),
    admit: async (flush) => {
      admitted.push(flush);
    },
    logger: { warn: () => undefined },
    schedule: (fire, delayMs) => {
      timers.push({ delayMs, fire });
      return () => undefined;
    },
  });
  return { scheduler, timers, admitted, running };
}

const SCOPE = {
  organizationId: "org",
  channel: "slack",
  accountId: "work",
  bindingKey: inboxBindingKey({ externalConversationId: "C0APP", externalThreadId: "171.1" }),
};

describe("HeldFlushScheduler", () => {
  it("arms a timer for the pause, then admits one flush row to the newest message's lane", async () => {
    const now = { value: 1_000 };
    const held = [row("m1", 1_000)];
    const { scheduler, timers, admitted } = schedulerHarness(held, now);

    await scheduler.watch({ scope: SCOPE, settings: BATCHING });
    assert.deepEqual(
      timers.map(({ delayMs }) => delayMs),
      [3_000],
    );
    assert.equal(admitted.length, 0);

    now.value = 4_000;
    timers[0]!.fire();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(admitted, [
      {
        externalEventId: `held-flush:${SCOPE.bindingKey}:m1`,
        externalConversationId: "C0APP",
        externalThreadId: "171.1",
        laneKey: "lane-1",
        payload: {
          kind: HELD_FLUSH_KIND,
          channel: "slack",
          accountId: "work",
          bindingKey: SCOPE.bindingKey,
        },
      },
    ]);
  });

  it("releases a queued binding when its turn ends", async () => {
    const now = { value: 1_000 };
    const { scheduler, admitted, running } = schedulerHarness([row("m1", 1_000)], now);
    running.add("agent-1");

    await scheduler.watch({ scope: SCOPE, settings: QUEUE, agentId: "agent-1" });
    assert.equal(admitted.length, 0, "held while the turn runs");

    running.delete("agent-1");
    await scheduler.turnEnded("agent-1");
    assert.equal(admitted.length, 1);
  });

  it("admits a flush for every binding a previous run left holding", async () => {
    const { scheduler, admitted } = schedulerHarness([row("m1", 1_000), row("m2", 1_500)], {
      value: 1_600,
    });
    await scheduler.recover({ organizationId: "org", channel: "slack", accountId: "work" });
    assert.deepEqual(
      admitted.map(({ externalEventId }) => externalEventId),
      [`held-flush:${SCOPE.bindingKey}:m2`],
    );
  });
});
