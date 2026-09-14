import { describe, expect, it } from "vitest";
import { PendingEventBudget } from "./pending-event-budget.js";
import { ForegroundTurnStream } from "../agent-run-state.js";
import type { AgentStreamEvent } from "../agent-sdk-types.js";
const event: AgentStreamEvent = {
  type: "timeline",
  provider: "codex",
  item: { type: "assistant_message", text: "payload" },
};
describe("pre-journal provider event admission", () => {
  it("bounds ten writers together and releases reservations exactly once", () => {
    const budget = new PendingEventBudget({ sessionBytes: 1024, totalBytes: 2048 });
    const releases: (() => void)[] = [];
    let rejected = 0;
    for (let agent = 0; agent < 10; agent += 1) {
      try {
        releases.push(budget.reserve(`${agent}`, event));
      } catch {
        rejected += 1;
      }
    }
    expect(rejected).toBeGreaterThan(0);
    expect(budget.pendingBytes).toBeLessThanOrEqual(2048);
    for (const release of releases) {
      release();
      release();
    }
    expect(budget.pendingBytes).toBe(0);
  });
  it("rejects a slow turn consumer and frees queued events without hanging after yield", async () => {
    const budget = new PendingEventBudget({ sessionBytes: 1024, totalBytes: 2048 });
    const stream = new ForegroundTurnStream("turn", (next) => budget.reserve("agent", next));
    stream.waiter.callback(event);
    const iterator = stream.events(() => false);
    expect((await iterator.next()).value).toEqual(event);
    for (let index = 0; index < 10; index += 1) stream.waiter.callback(event);
    await expect(iterator.next()).rejects.toThrow("byte limit");
    expect(budget.pendingBytes).toBe(0);
  });
  it("releases unconsumed events when a foreground waiter is disposed", () => {
    const budget = new PendingEventBudget();
    const stream = new ForegroundTurnStream("turn", (next) => budget.reserve("agent", next));
    stream.waiter.callback(event);
    expect(budget.pendingBytes).toBeGreaterThan(0);
    stream.dispose();
    stream.waiter.callback(event);
    expect(budget.pendingBytes).toBe(0);
  });
});
