import { describe, expect, it } from "vitest";
import {
  fetchAggregated,
  holdAggregateRows,
  toAggregateLoadState,
  type FetchAggregatedState,
  type HeldHostRows,
} from "./aggregate";
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
    expect(state.acceptedServerIds).toEqual(["a"]);
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
    expect(state).toEqual({ status: "loaded", data: [], hostErrors: [], acceptedServerIds: [] });
    expect(toAggregateLoadState(undefined)).toEqual({ status: "loading" });
  });
});

it("distinguishes a successful empty Host from an online Host without an askable client", async () => {
  const state = await fetchAggregated({
    hosts: HOSTS,
    runtime: runtime({
      a: { status: "online", client: { botList: async () => ({ bots: [] }) } },
      b: { status: "online" },
    }),
    load,
    allHostsFailedMessage: "all failed",
  });
  expect(state).toEqual({ status: "loaded", data: [], hostErrors: [], acceptedServerIds: ["a"] });
});

describe("holdAggregateRows (Round 2 D6: a list with rows never blanks)", () => {
  const row = (serverId: string, id: string) => ({ ...bot(id), serverId, serverName: serverId });
  const loaded = (
    data: ReturnType<typeof row>[],
    acceptedServerIds: string[],
  ): Extract<FetchAggregatedState<BotPayload>, { status: "loaded" }> => ({
    status: "loaded",
    data,
    hostErrors: [],
    acceptedServerIds,
  });
  const first = holdAggregateRows(
    new Map(),
    loaded([row("a", "a1"), row("a", "a2"), row("b", "b1")], ["a", "b"]),
    ["a", "b"],
  );

  function ids(state: FetchAggregatedState<BotPayload> | undefined) {
    return state?.status === "loaded" ? state.data.map((r) => r.id).sort() : state?.status;
  }

  it("keeps every row while a reconnect's new query has no answer yet", () => {
    for (const pending of [undefined, { status: "connecting" } as const]) {
      const next = holdAggregateRows(first.held, pending, ["a", "b"]);
      expect(ids(next.state)).toEqual(["a1", "a2", "b1"]);
      // Held rows prove nothing about the new admission.
      expect(next.state?.status === "loaded" && next.state.acceptedServerIds).toEqual([]);
    }
  });

  it("replaces a Host's rows when it answers and holds the Host that has not", () => {
    const next = holdAggregateRows(first.held, loaded([row("a", "a3")], ["a"]), ["a", "b"]);
    expect(ids(next.state)).toEqual(["a3", "b1"]);
    expect(next.state?.status === "loaded" && next.state.acceptedServerIds).toEqual(["a"]);
  });

  it("holds a failing Host's rows beside its error", () => {
    const failing: FetchAggregatedState<BotPayload> = {
      ...loaded([row("a", "a1"), row("a", "a2")], ["a"]),
      hostErrors: [{ serverId: "b", serverName: "b", message: "boom" }],
    };
    const next = holdAggregateRows(first.held, failing, ["a", "b"]);
    expect(ids(next.state)).toEqual(["a1", "a2", "b1"]);
    expect(next.state?.status === "loaded" && next.state.hostErrors).toHaveLength(1);
  });

  it("drops a Host's rows when it answers empty or leaves the list", () => {
    expect(ids(holdAggregateRows(first.held, loaded([], ["a", "b"]), ["a", "b"]).state)).toEqual(
      [],
    );
    expect(ids(holdAggregateRows(first.held, undefined, ["a"]).state)).toEqual(["a1", "a2"]);
    const none: HeldHostRows<BotPayload> = new Map();
    expect(holdAggregateRows(none, undefined, ["a"]).state).toBeUndefined();
  });
});
