import { describe, expect, it } from "vitest";
import { createOpenPreloadScheduler } from "./scheduler";
import { createOpenPreloads, type AgentOpenTarget, type ChatOpenTarget } from "./targets";

function createHarness() {
  const loads: string[] = [];
  const pending: Array<() => void> = [];
  function hold(label: string): Promise<void> {
    loads.push(label);
    return new Promise((resolve) => pending.push(resolve));
  }
  const preloads = createOpenPreloads(
    createOpenPreloadScheduler({ maxConcurrent: 2, freshMs: 30_000, now: () => 0 }),
    {
      loadAgent: (target: AgentOpenTarget) => hold(`agent:${target.serverId}/${target.agentId}`),
      loadChat: (target: ChatOpenTarget) => hold(`chat:${target.serverId}/${target.chatId}`),
    },
  );
  return { loads, preloads };
}

describe("open preloads", () => {
  it("starts a session's fetch when its row is pressed in", () => {
    const { loads, preloads } = createHarness();
    preloads.preloadAgent({ serverId: "h1", agentId: "a1" });
    expect(loads).toEqual(["agent:h1/a1"]);
  });

  it("starts a chat's transcript fetch when its row is pressed in", () => {
    const { loads, preloads } = createHarness();
    preloads.preloadChat({ serverId: "h1", chatId: "c1", presentationScope: "local" });
    expect(loads).toEqual(["chat:h1/c1"]);
  });

  it("drops the preloads still waiting for a slot when the list scrolls away", () => {
    const { loads, preloads } = createHarness();
    preloads.preloadAgent({ serverId: "h1", agentId: "a1" });
    preloads.preloadAgent({ serverId: "h1", agentId: "a2" });
    preloads.preloadAgent({ serverId: "h1", agentId: "a3" });
    preloads.cancelQueued();
    expect(loads).toEqual(["agent:h1/a1", "agent:h1/a2"]);
  });

  it("drops one row's waiting preload when that row leaves the top of the list", () => {
    const { loads, preloads } = createHarness();
    preloads.preloadAgent({ serverId: "h1", agentId: "a1" });
    preloads.preloadAgent({ serverId: "h1", agentId: "a2" });
    preloads.preloadAgent({ serverId: "h1", agentId: "a3" });
    preloads.cancelAgent({ serverId: "h1", agentId: "a3" });
    expect(loads).toEqual(["agent:h1/a1", "agent:h1/a2"]);
  });
});
