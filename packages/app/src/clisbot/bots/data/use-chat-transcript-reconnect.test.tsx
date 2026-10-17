// @vitest-environment jsdom
import React from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { DaemonConnectionError } from "@clisbot/client/internal/daemon-client";
import type { BotsClient, BotsRuntime } from "./client";
import type { ChatTranscriptPage } from "./contracts";
const state = vi.hoisted(() => ({ online: true, epoch: 1 }));
vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeSnapshot: () => ({
    connectionStatus: state.online ? "online" : "offline",
    clientGeneration: 1,
    connectionEpoch: state.epoch,
  }),
}));
import { useChatTranscriptQuery } from "./use-chat-transcript";
import { useTranscriptStore } from "./transcript-store";
afterEach(() => {
  cleanup();
  state.online = true;
  state.epoch = 1;
  useTranscriptStore.setState({ transcripts: {}, reads: {} });
});
it("uses the real query/cache owner to retain a reading page across failed refresh, offline and a held reconnect tail", async () => {
  const accepted: ChatTranscriptPage = {
    messages: [{ id: "read-line", seq: 8, text: "accepted", at: "now", sender: { kind: "user" } }],
    hasOlder: true,
    hasNewer: false,
  };
  let resolve!: (page: ChatTranscriptPage) => void;
  const fetch = vi
    .fn<BotsClient["chatTranscriptFetch"]>()
    .mockResolvedValueOnce(accepted)
    .mockRejectedValueOnce(new DaemonConnectionError("Connection lost"))
    .mockImplementationOnce(
      () =>
        new Promise((yes) => {
          resolve = yes;
        }),
    );
  const runtime: BotsRuntime = {
    getClient: () => ({ botList: vi.fn(), chatList: vi.fn(), chatTranscriptFetch: fetch }),
    getSnapshot: () => ({
      connectionStatus: state.online ? "online" : "offline",
      clientGeneration: 1,
      connectionEpoch: state.epoch,
    }),
  };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: React.PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    () =>
      useChatTranscriptQuery({
        serverId: "host",
        chatId: "chat",
        runtime,
        presentationScope: "principal",
      }),
    { wrapper },
  );
  await waitFor(() => expect(hook.result.current.loadState.status).toBe("loaded"));
  const page = hook.result.current.transcript;
  await act(async () => {
    await queryClient.invalidateQueries({ queryKey: ["chat-transcript"] });
  });
  await waitFor(() =>
    expect(hook.result.current.loadState).toMatchObject({ status: "error", retainAccepted: true }),
  );
  expect(hook.result.current.transcript).toBe(page);
  state.online = false;
  hook.rerender();
  expect(hook.result.current.transcript).toBe(page);
  state.online = true;
  state.epoch = 2;
  hook.rerender();
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
  expect(fetch.mock.calls[2][0].afterSeq).toBeUndefined();
  expect(hook.result.current.transcript).toBe(page);
  expect(useTranscriptStore.getState().transcripts["host@1:2:chat"]).toBeUndefined();
  await act(async () => resolve({ messages: [], hasOlder: false, hasNewer: false }));
  await waitFor(() => expect(hook.result.current.loadState.status).toBe("loaded"));
  expect(hook.result.current.transcript.messages).toEqual([]);
  hook.unmount();
  queryClient.clear();
});

it("does not use another principal's cursor or rows when client generation and epoch are unchanged", async () => {
  const accepted: ChatTranscriptPage = {
    messages: [{ id: "old-private", seq: 8, text: "private", at: "now", sender: { kind: "user" } }],
    hasOlder: true,
    hasNewer: false,
  };
  const fetch = vi
    .fn<BotsClient["chatTranscriptFetch"]>()
    .mockResolvedValueOnce(accepted)
    .mockResolvedValueOnce({ messages: [], hasOlder: false, hasNewer: false });
  const runtime: BotsRuntime = {
    getClient: () => ({ botList: vi.fn(), chatList: vi.fn(), chatTranscriptFetch: fetch }),
    getSnapshot: () => ({ connectionStatus: "online", clientGeneration: 1, connectionEpoch: 1 }),
  };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: React.PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  let principal = "first";
  const hook = renderHook(
    () =>
      useChatTranscriptQuery({
        serverId: "host",
        chatId: "chat",
        runtime,
        presentationScope: principal,
      }),
    { wrapper },
  );
  await waitFor(() => expect(hook.result.current.loadState.status).toBe("loaded"));
  principal = "second";
  hook.rerender();
  expect(hook.result.current.transcript.messages).toEqual([]);
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(hook.result.current.loadState.status).toBe("loaded"));
  expect(fetch.mock.calls[1][0].afterSeq).toBeUndefined();
  expect(hook.result.current.transcript.messages).toEqual([]);
  hook.unmount();
  queryClient.clear();
});

it("never flashes another principal's store on cached-query switchback or applies its late older page", async () => {
  const page = (id: string): ChatTranscriptPage => ({
    messages: [{ id, seq: 8, text: id, at: "now", sender: { kind: "user" } }],
    hasOlder: true,
    hasNewer: false,
  });
  let resolveOlder!: (page: ChatTranscriptPage) => void;
  let resolveReturn!: (page: ChatTranscriptPage) => void;
  const fetch = vi
    .fn<BotsClient["chatTranscriptFetch"]>()
    .mockResolvedValueOnce(page("A"))
    .mockImplementationOnce(
      () =>
        new Promise((yes) => {
          resolveOlder = yes;
        }),
    )
    .mockResolvedValueOnce(page("B"))
    .mockImplementationOnce(
      () =>
        new Promise((yes) => {
          resolveReturn = yes;
        }),
    );
  const runtime: BotsRuntime = {
    getClient: () => ({ botList: vi.fn(), chatList: vi.fn(), chatTranscriptFetch: fetch }),
    getSnapshot: () => ({ connectionStatus: "online", clientGeneration: 1, connectionEpoch: 1 }),
  };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: React.PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  let principal = "A";
  const renders: string[][] = [];
  const hook = renderHook(
    () => {
      const result = useChatTranscriptQuery({
        serverId: "host",
        chatId: "chat",
        runtime,
        presentationScope: principal,
      });
      renders.push(result.transcript.messages.map((line) => line.id));
      return result;
    },
    { wrapper },
  );
  await waitFor(() => expect(hook.result.current.loadState.status).toBe("loaded"));
  let older!: Promise<void>;
  act(() => {
    older = hook.result.current.loadOlder();
  });
  principal = "B";
  hook.rerender();
  await waitFor(() => expect(hook.result.current.transcript.messages[0]?.id).toBe("B"));
  await act(async () => {
    resolveOlder({ ...page("A-older"), messages: [{ ...page("A-older").messages[0], seq: 1 }] });
    await older;
  });
  expect(hook.result.current.transcript.messages.map((line) => line.id)).toEqual(["B"]);
  principal = "A";
  renders.length = 0;
  hook.rerender();
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(4));
  expect(renders.flat()).not.toContain("B");
  expect(hook.result.current.transcript.messages).toEqual([]);
  expect(fetch.mock.calls[3][0].afterSeq).toBeUndefined();
  await act(async () => resolveReturn(page("A-new")));
  await waitFor(() => expect(hook.result.current.transcript.messages[0]?.id).toBe("A-new"));
  hook.unmount();
  queryClient.clear();
});
