// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import type { ChatPayload } from "@getpaseo/protocol/chats/types";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { useChatSend } from "./use-chat-send";
vi.mock("../data/runtime", () => ({ refreshBotsAndChats: vi.fn() }));
const initial = { id: "chat-a", participants: [] } as unknown as ChatPayload;
function mount(client: DaemonClient) {
  return renderHook(() => {
    const [chat, setChat] = useState<ChatPayload | null>(initial);
    const [error, setError] = useState<string | null>(null);
    return {
      ...useChatSend(client, true, "chat-a", chat, setChat, setError),
      chat,
      setChat,
      error,
    };
  });
}
it("retries a lost ACK after a route remount using the original receipt", async () => {
  const sendChatMessage = vi
    .fn()
    .mockRejectedValueOnce(new Error("Connection closed"))
    .mockResolvedValue({});
  const client = {
    sendChatMessage,
    listChats: async () => ({ chats: [initial] }),
  } as unknown as DaemonClient;
  const first = mount(client);
  await act(async () => {
    await expect(first.result.current.send("hello")).rejects.toThrow("Connection closed");
  });
  first.unmount();
  const second = mount(client);
  await act(async () => {
    await second.result.current.send("hello");
  });
  expect(sendChatMessage.mock.calls[1][0].messageId).toBe(
    sendChatMessage.mock.calls[0][0].messageId,
  );
  await act(async () => {
    await second.result.current.send("hello");
  });
  expect(sendChatMessage.mock.calls[2][0].messageId).not.toBe(
    sendChatMessage.mock.calls[0][0].messageId,
  );
  second.unmount();
});
it("does not replace a pushed session binding with a stale post-send refresh", async () => {
  let resolve!: (value: { chats: ChatPayload[] }) => void;
  const client = {
    sendChatMessage: async () => ({}),
    listChats: () =>
      new Promise<{ chats: ChatPayload[] }>((yes) => {
        resolve = yes;
      }),
  } as unknown as DaemonClient;
  const hook = mount(client);
  await act(async () => {
    await hook.result.current.send("hello");
  });
  const newer = { ...initial, title: "New binding" };
  act(() => hook.result.current.setChat(newer));
  await act(async () => {
    resolve({ chats: [initial] });
  });
  expect(hook.result.current.chat).toBe(newer);
  hook.unmount();
});
