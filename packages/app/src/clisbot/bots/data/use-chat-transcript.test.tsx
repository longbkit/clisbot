// @vitest-environment jsdom
import { renderHook, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  DaemonConnectionError,
  DaemonAuthenticationError,
} from "@clisbot/client/internal/daemon-client";
const state = vi.hoisted(() => ({
  error: null as Error | null,
  data: undefined as unknown,
  epoch: 1,
  authFailure: false,
  key: [] as unknown[],
  fetching: false,
}));
vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeSnapshot: () => ({
    connectionStatus: "online",
    clientGeneration: 1,
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
import { useChatTranscriptQuery } from "./use-chat-transcript";
const runtime = { getClient: () => null, getSnapshot: () => null };
afterEach(() => {
  cleanup();
  state.error = null;
  state.data = undefined;
  state.epoch = 1;
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

it("does not treat connection-lost or a rejected admission as a recoverable refresh timeout", () => {
  state.data = { messages: [], hasOlder: false };
  state.error = new DaemonConnectionError("Connection lost");
  const hook = renderHook(() =>
    useChatTranscriptQuery({ serverId: "host", chatId: "chat", runtime }),
  );
  expect(hook.result.current.loadState).toMatchObject({ retainAccepted: false });
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
