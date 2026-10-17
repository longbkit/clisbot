// @vitest-environment jsdom
import { act, renderHook, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  DaemonConnectionError,
  DaemonAuthenticationError,
} from "@clisbot/client/internal/daemon-client";
const state = vi.hoisted(() => ({
  error: null as Error | null,
  data: undefined as unknown,
  epoch: 1,
  generation: 1,
  online: true,
  authFailure: false,
  key: [] as unknown[],
  fetching: false,
}));
vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeSnapshot: () => ({
    connectionStatus: state.online ? "online" : "offline",
    clientGeneration: state.generation,
    connectionEpoch: state.epoch,
    authFailureReason: state.authFailure ? "incorrect_password" : null,
  }),
}));
vi.mock("@/data/query", () => ({
  useFetchQuery: (options: { queryKey: unknown[] }) => {
    state.key = options.queryKey;
    return {
      data: state.data,
      error: state.error,
      isError: state.error !== null,
      isFetching: state.fetching,
    };
  },
}));
import { useTranscriptStore } from "./transcript-store";
import { useChatTranscriptQuery } from "./use-chat-transcript";
const runtime = { getClient: () => null, getSnapshot: () => null };
afterEach(() => {
  cleanup();
  state.error = null;
  state.data = undefined;
  state.epoch = 1;
  state.generation = 1;
  state.online = true;
  useTranscriptStore.setState({ transcripts: {}, reads: {} });
  state.authFailure = false;
  state.fetching = false;
});
it("retains an accepted page only for a typed transport error, not a first-load failure", () => {
  state.error = new DaemonConnectionError("Timeout", "DAEMON_REQUEST_TIMEOUT");
  const hook = renderHook(() =>
    useChatTranscriptQuery({ serverId: "host", chatId: "chat", runtime }),
  );
  expect(hook.result.current.loadState).toMatchObject({ status: "error", retainAccepted: false });
  state.data = { messages: [], hasOlder: false };
  hook.rerender();
  expect(hook.result.current.loadState).toMatchObject({ status: "error", retainAccepted: true });
});
it("never keeps a page visible for auth or unclassified/RPC errors", () => {
  state.data = { messages: [], hasOlder: false };
  state.error = new Error("Denied");
  const hook = renderHook(() =>
    useChatTranscriptQuery({ serverId: "host", chatId: "chat", runtime }),
  );
  expect(hook.result.current.loadState).toMatchObject({ status: "error", retainAccepted: false });
  state.error = new DaemonAuthenticationError("incorrect_password");
  hook.rerender();
  expect(hook.result.current.loadState).toMatchObject({ status: "error", retainAccepted: false });
});
it("addresses a new admission independently rather than using the previous query page", () => {
  const hook = renderHook(() =>
    useChatTranscriptQuery({ serverId: "host", chatId: "chat", runtime }),
  );
  const first = [...state.key];
  state.epoch = 2;
  hook.rerender();
  expect(state.key).not.toEqual(first);
  expect(state.key.at(-1)).toBe("1:2");
});

it("retains connection-lost only while authentication has not rejected the admission", () => {
  state.data = { messages: [], hasOlder: false };
  state.error = new DaemonConnectionError("Connection lost");
  const hook = renderHook(() =>
    useChatTranscriptQuery({ serverId: "host", chatId: "chat", runtime }),
  );
  expect(hook.result.current.loadState).toMatchObject({ retainAccepted: true });
  state.error = new DaemonConnectionError("Timeout", "DAEMON_REQUEST_TIMEOUT");
  state.authFailure = true;
  hook.rerender();
  expect(hook.result.current.loadState).toMatchObject({ retainAccepted: false });
});

it("reports an active refresh independently of already loaded content", () => {
  state.data = { messages: [], hasOlder: false };
  state.fetching = true;
  const hook = renderHook(() =>
    useChatTranscriptQuery({ serverId: "host", chatId: "chat", runtime }),
  );
  expect(hook.result.current.loadState.status).toBe("loaded");
  expect(hook.result.current.isFetching).toBe(true);
  state.fetching = false;
  hook.rerender();
  expect(hook.result.current.loadState.status).toBe("loaded");
  expect(hook.result.current.isFetching).toBe(false);
});

it("keeps the exact accepted page through transport loss and same-client readmission without seeding its new store", () => {
  const page = {
    messages: [
      { id: "accepted", seq: 1, text: "private", at: "now", sender: { kind: "user" as const } },
    ],
    hasOlder: true,
  };
  useTranscriptStore.getState().replacePage("host@1:1:chat", page);
  state.data = page;
  const hook = renderHook(() =>
    useChatTranscriptQuery({ serverId: "host", chatId: "chat", runtime }),
  );
  const accepted = hook.result.current.transcript;
  state.error = new DaemonConnectionError("Connection lost");
  hook.rerender();
  expect(hook.result.current.loadState).toMatchObject({ retainAccepted: true });
  expect(hook.result.current.transcript).toBe(accepted);
  state.online = false;
  state.data = undefined;
  state.error = null;
  hook.rerender();
  expect(hook.result.current.transcript).toBe(accepted);
  state.online = true;
  state.epoch = 2;
  state.fetching = true;
  hook.rerender();
  expect(hook.result.current.transcript).toBe(accepted);
  expect(useTranscriptStore.getState().transcripts["host@1:2:chat"]).toBeUndefined();
  act(() =>
    useTranscriptStore.getState().replacePage("host@1:2:chat", { messages: [], hasOlder: false }),
  );
  state.data = { messages: [], hasOlder: false };
  hook.rerender();
  expect(hook.result.current.transcript.messages).toEqual([]);
});

it.each(["generation", "principal", "auth", "denied"] as const)(
  "does not retain private presentation across %s",
  (boundary) => {
    const page = {
      messages: [
        { id: "private", seq: 1, text: "private", at: "now", sender: { kind: "user" as const } },
      ],
      hasOlder: false,
    };
    const store = useTranscriptStore.getState();
    const read = store.beginRead("host@1:1:chat", "first");
    store.acceptRead("host@1:1:chat", read, page, false);
    state.data = page;
    let principal = "first";
    const hook = renderHook(() =>
      useChatTranscriptQuery({
        serverId: "host",
        chatId: "chat",
        runtime,
        presentationScope: principal,
      }),
    );
    expect(hook.result.current.transcript.messages).toEqual(page.messages);
    state.epoch++;
    state.data = undefined;
    if (boundary === "generation") state.generation++;
    if (boundary === "principal") principal = "second";
    if (boundary === "auth") state.authFailure = true;
    if (boundary === "denied") state.error = new Error("Forbidden");
    hook.rerender();
    expect(hook.result.current.transcript.messages).toEqual([]);
  },
);

it("revokes retained presentation on metadata removal and does not resurrect it during another reconnect", () => {
  const page = {
    messages: [
      { id: "removed", seq: 1, text: "private", at: "now", sender: { kind: "user" as const } },
    ],
    hasOlder: false,
  };
  useTranscriptStore.getState().replacePage("host@1:1:chat", page);
  state.data = page;
  let allowed = true;
  const hook = renderHook(() =>
    useChatTranscriptQuery({
      serverId: "host",
      chatId: "chat",
      runtime,
      presentationAllowed: allowed,
    }),
  );
  state.epoch = 2;
  state.data = undefined;
  allowed = false;
  hook.rerender();
  expect(hook.result.current.transcript.messages).toEqual([]);
  state.epoch = 3;
  allowed = true;
  hook.rerender();
  expect(hook.result.current.transcript.messages).toEqual([]);
});
