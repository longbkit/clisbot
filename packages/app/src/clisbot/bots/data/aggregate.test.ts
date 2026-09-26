import { describe, expect, it } from "vitest";
import { fetchAggregated, toAggregateLoadState } from "./aggregate";
import type { BotsClient, BotsRuntime } from "./client";
import type { BotPayload } from "./contracts";

function bot(id: string): BotPayload {
  return {
    id,
    slug: id,
    name: id,
    projectId: `p-${id}`,
    workspaceId: `w-${id}`,
    cwd: `/bots/${id}`,
    kind: "personal",
    launchDefaults: { provider: "mock" },
  };
}

function runtime(
  hosts: Record<string, { status: string; client?: Partial<BotsClient> }>,
): BotsRuntime {
  return {
    getClient: (serverId) => (hosts[serverId]?.client as BotsClient | undefined) ?? null,
    getSnapshot: (serverId) =>
      hosts[serverId] ? { connectionStatus: hosts[serverId].status } : undefined,
  };
}

const HOSTS = [
  { serverId: "a", serverName: "Host A" },
  { serverId: "b", serverName: "Host B" },
];

const load = async (client: BotsClient) => {
  const payload = await client.botList();
  return { rows: payload.bots, error: payload.error };
};

describe("fetchAggregated", () => {
  it("reports connecting while no host can be asked yet", async () => {
    const state = await fetchAggregated({
      hosts: HOSTS,
      runtime: runtime({ a: { status: "connecting" }, b: { status: "idle" } }),
      load,
      allHostsFailedMessage: "all failed",
    });
    expect(state).toEqual({ status: "connecting" });
    expect(toAggregateLoadState(state)).toEqual({ status: "connecting" });
  });

  it("tags rows with their host and keeps a failing host as a banner", async () => {
    const state = await fetchAggregated({
      hosts: HOSTS,
      runtime: runtime({
        a: { status: "online", client: { botList: async () => ({ bots: [bot("x")] }) } },
        b: { status: "online", client: { botList: async () => ({ bots: [], error: "boom" }) } },
      }),
      load,
      allHostsFailedMessage: "all failed",
    });
    expect(state.status).toBe("loaded");
    if (state.status !== "loaded") throw new Error("expected loaded");
    expect(state.data).toEqual([{ ...bot("x"), serverId: "a", serverName: "Host A" }]);
    expect(state.hostErrors).toEqual([{ serverId: "b", serverName: "Host B", message: "boom" }]);
  });

  it("throws only when every asked host failed", async () => {
    await expect(
      fetchAggregated({
        hosts: HOSTS,
        runtime: runtime({
          a: { status: "online", client: { botList: async () => ({ bots: [], error: "x" }) } },
          b: { status: "offline" },
        }),
        load,
        allHostsFailedMessage: "all failed",
      }),
    ).rejects.toThrow("all failed");
  });

  it("is an empty loaded list when every host is offline", async () => {
    const state = await fetchAggregated({
      hosts: HOSTS,
      runtime: runtime({ a: { status: "offline" }, b: { status: "offline" } }),
      load,
      allHostsFailedMessage: "all failed",
    });
    expect(state).toEqual({ status: "loaded", data: [], hostErrors: [] });
    expect(toAggregateLoadState(undefined)).toEqual({ status: "loading" });
  });
});
