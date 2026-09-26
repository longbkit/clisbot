// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { ChatPayload } from "@getpaseo/protocol/chats/types";
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
