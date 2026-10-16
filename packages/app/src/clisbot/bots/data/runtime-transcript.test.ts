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
import { botsRuntime } from "./runtime";

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
