// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { DaemonClient } from "@clisbot/client/internal/daemon-client";
import type { ChatPayload } from "@clisbot/protocol/chats/types";
import { useChatRecord } from "./use-chat-record";
function fixture() {
  let resolve!: (value: { chats: ChatPayload[] }) => void;
  let reject!: (error: Error) => void;
  let push!: (event: { type: "chat.updated"; payload: { chat: ChatPayload } }) => void;
  const request = new Promise<{ chats: ChatPayload[] }>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  const release = vi.fn(async () => {});
  const client = {
    listChats: () => request,
    observeEvents: () => ({
      subscribe: (observer: { update: typeof push }) => {
        push = observer.update;
      },
      release,
    }),
  } as unknown as DaemonClient;
  const hook = renderHook(() => useChatRecord(client, true, "chat-a", "host:chat-a"));
  const chat = (agentId: string) =>
    ({ id: "chat-a", participants: [{ botId: "bot-a", agentId }] }) as ChatPayload;
  return {
    hook,
    resolve,
    reject,
    update: (agentId: string) => push({ type: "chat.updated", payload: { chat: chat(agentId) } }),
    chat,
    release,
  };
}
it("keeps the new session binding when an older initial fetch resolves after a push", async () => {
  const f = fixture();
  act(() => f.update("new-agent"));
  await act(async () => {
    f.resolve({ chats: [f.chat("old-agent")] });
  });
  expect(f.hook.result.current.chat?.participants[0].agentId).toBe("new-agent");
  f.hook.unmount();
  expect(f.release).toHaveBeenCalledOnce();
});
it("does not discard a valid pushed chat when the initial RPC subsequently fails", async () => {
  const f = fixture();
  act(() => f.update("new-agent"));
  await act(async () => {
    f.reject(new Error("old request failed"));
  });
  expect(f.hook.result.current.chat?.participants[0].agentId).toBe("new-agent");
  expect(f.hook.result.current.error).toBeNull();
  f.hook.unmount();
});
it("still loads an initial record when no newer push has arrived", async () => {
  const f = fixture();
  await act(async () => {
    f.resolve({ chats: [f.chat("existing-agent")] });
  });
  await waitFor(() =>
    expect(f.hook.result.current.chat?.participants[0].agentId).toBe("existing-agent"),
  );
  f.hook.unmount();
});

it("shows an accepted catalog record synchronously on remount while its refresh is pending", async () => {
  const accepted = {
    id: "chat-a",
    participants: [{ botId: "bot-a", agentId: "cached" }],
  } as ChatPayload;
  let resolve!: (value: { chats: ChatPayload[]; error?: string }) => void;
  const client = {
    listChats: vi.fn(
      () =>
        new Promise((yes) => {
          resolve = yes;
        }),
    ),
    observeEvents: () => ({ subscribe: () => {}, release: async () => {} }),
  } as unknown as DaemonClient;
  const first = renderHook(() =>
    useChatRecord(client, true, "chat-a", "admission:chat-a", accepted),
  );
  expect(first.result.current.chat).toBe(accepted);
  await act(async () => resolve({ chats: [accepted] }));
  first.unmount();
  const second = renderHook(() =>
    useChatRecord(client, true, "chat-a", "admission:chat-a", accepted),
  );
  expect(second.result.current.chat).toBe(accepted);
  await act(async () => resolve({ chats: [] }));
  expect(second.result.current.chat).toBeNull();
  expect(second.result.current.error).toBeTruthy();
  second.unmount();
});
it("authoritative refresh denial clears seeded metadata and held transcript", async () => {
  const accepted = { id: "chat-a", participants: [] } as unknown as ChatPayload;
  const { useTranscriptStore } = await import("../data/transcript-store");
  useTranscriptStore.getState().replacePage("admission:chat-a", { messages: [], hasOlder: true });
  let resolve!: (value: { chats: ChatPayload[]; error?: string }) => void;
  const client = {
    listChats: () =>
      new Promise((yes) => {
        resolve = yes;
      }),
    observeEvents: () => ({ subscribe: () => {}, release: async () => {} }),
  } as unknown as DaemonClient;
  const hook = renderHook(() =>
    useChatRecord(client, true, "chat-a", "admission:chat-a", accepted),
  );
  expect(hook.result.current.chat).toBe(accepted);
  await act(async () => resolve({ chats: [], error: "denied" }));
  expect(hook.result.current.chat).toBeNull();
  expect(useTranscriptStore.getState().transcripts["admission:chat-a"]).toBeUndefined();
  hook.unmount();
});

it("retains accepted metadata on a typed transport timeout but exposes the error", async () => {
  const { DaemonConnectionError } = await import("@clisbot/client/internal/daemon-client");
  const accepted = { id: "chat-a", participants: [] } as unknown as ChatPayload;
  const client = {
    listChats: () => Promise.reject(new DaemonConnectionError("Timeout", "DAEMON_REQUEST_TIMEOUT")),
    observeEvents: () => ({ subscribe: () => {}, release: async () => {} }),
  } as unknown as DaemonClient;
  const hook = renderHook(() =>
    useChatRecord(client, true, "chat-a", "admission:chat-a", accepted),
  );
  await waitFor(() => expect(hook.result.current.error).toContain("Timeout"));
  expect(hook.result.current.chat).toBe(accepted);
  hook.unmount();
});
