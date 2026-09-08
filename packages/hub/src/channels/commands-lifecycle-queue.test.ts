import { describe, expect, it, vi } from "vitest";
import type { DaemonConnection } from "./daemon/client.js";
import { ChannelCommandTurnQueue } from "./commands-lifecycle-queue.js";

describe("channel command turn queue", () => {
  it("releases FIFO at turn boundaries, deduplicates replayed events, clears on detach", async () => {
    const sendAgentMessage = vi.fn<DaemonConnection["sendAgentMessage"]>(async () => undefined);
    const queue = new ChannelCommandTurnQueue({ sendAgentMessage });
    await queue.enqueue("agent", "first", true, async () => true);
    await queue.enqueue("agent", "second", true, async () => true);
    expect(sendAgentMessage).not.toHaveBeenCalled();
    await queue.onStream("agent", { type: "turn_completed", turnId: "t1" });
    await queue.onStream("agent", { type: "turn_completed", turnId: "t1" });
    expect(sendAgentMessage).toHaveBeenCalledTimes(1);
    await queue.onStream("agent", { type: "turn_started", turnId: "t2" });
    await queue.onStream("agent", { type: "turn_completed", turnId: "t2" });
    expect(sendAgentMessage.mock.calls.map((call) => call[1])).toEqual(["first", "second"]);
    await queue.enqueue("agent", "discard", true, async () => true);
    queue.clear("agent");
    await queue.onStream("agent", { type: "turn_completed", turnId: "t3" });
    expect(sendAgentMessage).toHaveBeenCalledTimes(2);
  });
  it("rechecks access before releasing a held message", async () => {
    const sendAgentMessage = vi.fn<DaemonConnection["sendAgentMessage"]>(async () => undefined);
    const queue = new ChannelCommandTurnQueue({ sendAgentMessage });
    const post = vi.fn(async () => true);
    const authorize = vi.fn(async () => false);
    await queue.enqueue("agent", "revoked", true, post, authorize);
    await queue.onStream("agent", { type: "turn_completed", turnId: "t1" });
    expect(authorize).toHaveBeenCalledOnce();
    expect(sendAgentMessage).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith(expect.stringContaining("access no longer allows"));
  });
  it("keeps the message held when another client has already started a turn", async () => {
    const sendAgentMessage = vi.fn<DaemonConnection["sendAgentMessage"]>(async () => undefined);
    const listAgents = vi.fn<DaemonConnection["listAgents"]>(async () => [
      { id: "agent", status: "running" } as Awaited<
        ReturnType<DaemonConnection["listAgents"]>
      >[number],
    ]);
    const queue = new ChannelCommandTurnQueue({ sendAgentMessage, listAgents });
    await queue.enqueue("agent", "later", true, async () => true);
    await queue.onStream("agent", { type: "turn_completed", turnId: "t1" });
    expect(sendAgentMessage).not.toHaveBeenCalled();
    listAgents.mockResolvedValue([]);
    await queue.onStream("agent", { type: "turn_completed", turnId: "t2" });
    expect(sendAgentMessage).toHaveBeenCalledWith("agent", "later", { steer: true });
  });
  it("sends immediately when idle and reports uncertain delivery without replay", async () => {
    const sendAgentMessage = vi.fn(async () => {
      throw new Error("disconnected");
    });
    const queue = new ChannelCommandTurnQueue({ sendAgentMessage });
    const post = vi.fn(async () => true);
    await queue.enqueue("agent", "queued", false, post);
    expect(post).toHaveBeenCalledWith(expect.stringContaining("disconnected"));
    await queue.onStream("agent", { type: "turn_completed", turnId: "t2" });
    expect(sendAgentMessage).toHaveBeenCalledTimes(1);
  });
});
