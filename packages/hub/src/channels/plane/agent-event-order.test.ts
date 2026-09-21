import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { AgentEventOrder } from "./agent-event-order.js";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe("agent event order", () => {
  it("runs one agent's events in arrival order and agents side by side", async () => {
    const order = new AgentEventOrder();
    const seen: string[] = [];
    const event = (agentId: string, name: string, ms: number) =>
      order.run(agentId, async () => {
        await sleep(ms);
        seen.push(name);
      });
    await Promise.all([
      event("agent-a", "a-slow-post", 30),
      event("agent-a", "a-final", 0),
      event("agent-b", "b-final", 0),
    ]);
    assert.deepEqual(seen, ["b-final", "a-slow-post", "a-final"]);
  });

  it("stops waiting for an event that never settles", async () => {
    const order = new AgentEventOrder(20);
    void order.run("agent-a", () => new Promise<void>(() => undefined));
    let completed = false;
    await order.run("agent-a", async () => {
      completed = true;
    });
    assert.equal(completed, true, "the turn's terminal event still gets handled");
  });

  it("keeps going after an event fails, and reports the failure to its caller", async () => {
    const order = new AgentEventOrder();
    const failed = order.run("agent-a", async () => {
      throw new Error("post failed");
    });
    const next = order.run("agent-a", async () => undefined);
    await assert.rejects(failed, /post failed/);
    await next;
  });
});
