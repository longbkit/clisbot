import { beforeEach, expect, it, vi } from "vitest";
import type { BotsClient, BotsRuntime, BotsRuntimeSnapshot } from "./client";
import type { ChatMessage, ChatTranscriptPage } from "./contracts";
import { scopedTranscriptKey } from "./session-scope";
import { selectTranscript, useTranscriptStore } from "./transcript-store";
import { refreshChatTranscript } from "./transcript-refresh";

vi.mock("@/i18n/i18next", () => ({ i18n: { t: (key: string) => key } }));

const snapshot: BotsRuntimeSnapshot = {
  connectionStatus: "online",
  clientGeneration: 1,
  connectionEpoch: 1,
};
let currentSnapshot: BotsRuntimeSnapshot | null;
const fetch = vi.fn<BotsClient["chatTranscriptFetch"]>();
const runtime: BotsRuntime = {
  getClient: () => ({ botList: vi.fn(), chatList: vi.fn(), chatTranscriptFetch: fetch }),
  getSnapshot: () => currentSnapshot,
};
const key = scopedTranscriptKey("host", "chat", snapshot);
const input = { serverId: "host", chatId: "chat", key };
const line = (seq: number): ChatMessage => ({
  id: `line-${seq}`,
  seq,
  at: "2026-10-16",
  text: `message ${seq}`,
  sender: { kind: "user" },
});
const page = (seqs: number[], hasOlder = false, hasNewer = false): ChatTranscriptPage => ({
  messages: seqs.map(line),
  hasOlder,
  hasNewer,
});
const transcript = () => selectTranscript(useTranscriptStore.getState(), key);
const seed = (seqs: number[], hasOlder = false) =>
  useTranscriptStore.getState().replacePage(key, page(seqs, hasOlder));
function held() {
  let resolve!: (value: ChatTranscriptPage) => void;
  const promise = new Promise<ChatTranscriptPage>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

beforeEach(() => {
  currentSnapshot = { ...snapshot };
  fetch.mockReset();
  useTranscriptStore.setState({ transcripts: {}, reads: {} });
});

it("fetches an authoritative cold tail, then only a delta on unchanged reentry", async () => {
  fetch.mockResolvedValueOnce(page([10, 11], true)).mockResolvedValueOnce(page([]));
  await refreshChatTranscript(runtime, input);
  const accepted = transcript();
  const listener = vi.fn();
  const release = useTranscriptStore.subscribe((state, previous) => {
    if (state.transcripts[key] !== previous.transcripts[key]) listener();
  });
  await refreshChatTranscript(runtime, input);
  release();
  expect(fetch.mock.calls.map(([value]) => value.afterSeq)).toEqual([undefined, 11]);
  expect(fetch.mock.calls.every(([value]) => value.limit === 50)).toBe(true);
  expect(transcript()).toBe(accepted);
  expect(transcript().messages).toBe(accepted.messages);
  expect(listener).not.toHaveBeenCalled();
});

it("uses cursor zero after an accepted empty tail, not another cold tail", async () => {
  fetch.mockResolvedValueOnce(page([])).mockResolvedValueOnce(page([1]));
  await refreshChatTranscript(runtime, input);
  await refreshChatTranscript(runtime, input);
  expect(fetch.mock.calls[1]?.[0].afterSeq).toBe(0);
  expect(transcript().messages.map((message) => message.seq)).toEqual([1]);
});

it("a pushed line ahead of the fetched cursor cannot skip the middle", async () => {
  seed([10, 11], true);
  useTranscriptStore.getState().append(key, line(14));
  fetch.mockResolvedValue(page([12, 13, 14]));
  await refreshChatTranscript(runtime, input);
  expect(fetch).toHaveBeenCalledWith({
    chatId: "chat",
    afterSeq: 11,
    beforeSeq: undefined,
    limit: 50,
  });
  expect(transcript().messages.map((message) => message.seq)).toEqual([10, 11, 12, 13, 14]);
});

it("preserves older loaded pages and a concurrent live append through a contiguous refresh", async () => {
  seed([3, 4], true);
  const deferred = held();
  fetch.mockReturnValue(deferred.promise);
  const refresh = refreshChatTranscript(runtime, input);
  useTranscriptStore.getState().prependOlder(key, [line(1), line(2)], false);
  useTranscriptStore.getState().append(key, line(7));
  deferred.resolve(page([5, 6]));
  await refresh;
  expect(transcript().messages.map((message) => message.seq)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  expect(transcript().hasOlder).toBe(false);
  expect(useTranscriptStore.getState().reads[key]?.afterSeq).toBe(6);
});

it("rejects an old delta after the same key is cleared and recreated", async () => {
  seed([1, 2]);
  const deferred = held();
  fetch.mockReturnValue(deferred.promise);
  const refresh = refreshChatTranscript(runtime, input);
  useTranscriptStore.getState().clear(key);
  seed([1, 2]);
  const recreated = transcript();
  deferred.resolve(page([3, 4]));
  await refresh;
  expect(transcript()).toBe(recreated);
  expect(useTranscriptStore.getState().reads[key]?.afterSeq).toBe(2);
});

it("does not resurrect a cleared cold read", async () => {
  const deferred = held();
  fetch.mockReturnValue(deferred.promise);
  const refresh = refreshChatTranscript(runtime, input);
  useTranscriptStore.getState().clear(key);
  deferred.resolve(page([1, 2]));
  await refresh;
  expect(useTranscriptStore.getState().transcripts[key]).toBeUndefined();
});

it("overlapping responses cannot regress accepted fetch coverage", async () => {
  seed([1, 2]);
  const first = held();
  const second = held();
  fetch.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const a = refreshChatTranscript(runtime, input);
  const b = refreshChatTranscript(runtime, input);
  second.resolve(page([3, 4]));
  await b;
  const accepted = transcript();
  first.resolve(page([3]));
  await a;
  expect(transcript()).toBe(accepted);
  expect(useTranscriptStore.getState().reads[key]?.afterSeq).toBe(4);
});

it("bounds overflow with one truthful tail replacement instead of merging a disjoint window", async () => {
  seed([1, 2]);
  fetch
    .mockResolvedValueOnce(page([3, 4], true, true))
    .mockResolvedValueOnce(page([99, 100], true));
  await refreshChatTranscript(runtime, input);
  expect(fetch.mock.calls.map(([value]) => value.afterSeq)).toEqual([2, undefined]);
  expect(transcript().messages.map((message) => message.seq)).toEqual([99, 100]);
  expect(transcript().hasOlder).toBe(true);
  expect(useTranscriptStore.getState().reads[key]?.afterSeq).toBe(100);
});

it.each([
  { messages: [line(8)], hasOlder: true, hasNewer: false },
  { messages: [], hasOlder: false },
])(
  "uses a bounded tail when a response does not establish a complete contiguous delta",
  async (response) => {
    seed([1, 2]);
    fetch.mockResolvedValueOnce(response).mockResolvedValueOnce(page([7, 8], true));
    await refreshChatTranscript(runtime, input);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(transcript().messages.map((message) => message.seq)).toEqual([7, 8]);
  },
);

it("keeps the fetched cursor on failure so retry still reads missed lines", async () => {
  seed([1, 2]);
  const accepted = transcript();
  fetch.mockRejectedValueOnce(new Error("transport failure")).mockResolvedValueOnce(page([3]));
  await expect(refreshChatTranscript(runtime, input)).rejects.toThrow("transport failure");
  expect(transcript()).toBe(accepted);
  await refreshChatTranscript(runtime, input);
  expect(fetch.mock.calls.map(([value]) => value.afterSeq)).toEqual([2, 2]);
});

it("does not convert an authority denial into a delta success or fallback", async () => {
  seed([1, 2]);
  fetch.mockResolvedValue({ ...page([]), error: "Denied" });
  await expect(refreshChatTranscript(runtime, input)).rejects.toThrow("Denied");
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(useTranscriptStore.getState().reads[key]?.afterSeq).toBe(2);
});

it.each(["epoch", "principal", "removed", "auth"])(
  "rejects old response after %s changes admission",
  async (change) => {
    seed([1, 2]);
    const accepted = transcript();
    const deferred = held();
    fetch.mockReturnValue(deferred.promise);
    const refresh = refreshChatTranscript(runtime, input);
    if (change === "epoch") currentSnapshot = { ...snapshot, connectionEpoch: 2 };
    if (change === "principal") currentSnapshot = { ...snapshot, clientGeneration: 2 };
    if (change === "removed") currentSnapshot = null;
    if (change === "auth") currentSnapshot = { ...snapshot, authFailureReason: "denied" };
    deferred.resolve(page([3]));
    await refresh;
    expect(transcript()).toBe(accepted);
    if (change === "epoch" || change === "principal") {
      fetch.mockResolvedValueOnce(page([8, 9], true));
      await refreshChatTranscript(runtime, {
        ...input,
        key: scopedTranscriptKey("host", "chat", currentSnapshot),
      });
      expect(fetch.mock.calls[1]?.[0].afterSeq).toBeUndefined();
    }
  },
);
