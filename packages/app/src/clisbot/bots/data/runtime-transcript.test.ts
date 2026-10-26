import { beforeEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@/runtime/host-runtime", () => ({
  getHostRuntimeStore: () => ({
    getClient: () => ({ fetchChatTranscript: fixture.fetch }),
    getSnapshot: () => ({ clientGeneration: 1, connectionEpoch: 1 }),
  }),
  useHostRuntimeConnectionStatuses: vi.fn(),
}));
vi.mock("@/data/query-client", () => ({ queryClient: {} }));
vi.mock("../feature", () => ({ useBotsFeatureHosts: vi.fn() }));
vi.mock("./use-bots", () => ({ useBotsQuery: vi.fn() }));
vi.mock("./use-chats", () => ({ useChatsQuery: vi.fn() }));
import { botsRuntime, reconcileHostFeeds } from "./runtime";

beforeEach(() => {
  fixture.fetch
    .mockReset()
    .mockResolvedValue({ lines: [], hasOlder: true, hasNewer: false, error: null });
});
it("maps tail, before, and after zero to the canonical RPC without losing hasNewer", async () => {
  const client = botsRuntime.getClient("host")!;
  for (const input of [{}, { beforeSeq: 8 }, { afterSeq: 0 }]) {
    const page = await client.chatTranscriptFetch({ chatId: "chat", limit: 50, ...input });
    expect(page).toEqual({ messages: [], hasOlder: true, hasNewer: false, error: undefined });
  }
  expect(fixture.fetch.mock.calls.map(([input]) => input)).toEqual([
    { chatId: "chat", direction: "tail", cursor: undefined, limit: 50 },
    { chatId: "chat", direction: "before", cursor: { seq: 8 }, limit: 50 },
    { chatId: "chat", direction: "after", cursor: { seq: 0 }, limit: 50 },
  ]);
});

it("keeps a Host's catalog feed while other Hosts come and go (one churning Host refetched every chat)", () => {
  const releases = new Map<string, ReturnType<typeof vi.fn>>();
  const retain = vi.fn((serverId: string) => {
    const release = vi.fn();
    releases.set(serverId, release);
    return release;
  });
  const feeds = new Map<string, { key: string; release: () => void }>();
  reconcileHostFeeds(
    feeds,
    new Map([
      ["home", "online:1:1"],
      ["uat", "online:1:1"],
    ]),
    retain,
  );
  expect(retain).toHaveBeenCalledTimes(2);
  // The sandbox is revoked, removed, re-added and reconnects: home's feed is never restarted.
  reconcileHostFeeds(feeds, new Map([["home", "online:1:1"]]), retain);
  reconcileHostFeeds(
    feeds,
    new Map([
      ["home", "online:1:1"],
      ["uat", "connecting:2:1"],
    ]),
    retain,
  );
  const homeRelease = releases.get("home")!;
  expect(homeRelease).not.toHaveBeenCalled();
  expect(retain.mock.calls.map(([id]) => id)).toEqual(["home", "uat", "uat"]);
  // Home's own reconnect does restart it.
  reconcileHostFeeds(
    feeds,
    new Map([
      ["home", "online:1:2"],
      ["uat", "connecting:2:1"],
    ]),
    retain,
  );
  expect(homeRelease).toHaveBeenCalledTimes(1);
  expect(retain.mock.calls.at(-1)).toEqual(["home"]);
});
