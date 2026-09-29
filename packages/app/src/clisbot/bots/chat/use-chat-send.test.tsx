// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import type { ChatPayload } from "@clisbot/protocol/chats/types";
import type { DaemonClient } from "@clisbot/client/internal/daemon-client";
import { useChatSend } from "./use-chat-send";
vi.mock("@/utils/encode-images", () => ({
  encodeImages: async (images: unknown[]) =>
    images.length ? [{ data: "AA==", mimeType: "image/png" }] : undefined,
}));
vi.mock("../data/runtime", () => ({ refreshBotsAndChats: vi.fn() }));
const initial = { id: "chat-a", participants: [] } as unknown as ChatPayload;
function mount(client: DaemonClient, attachmentsSupported = true) {
  return renderHook(() => {
    const [chat, setChat] = useState<ChatPayload | null>(initial);
    const [error, setError] = useState<string | null>(null);
    return {
      ...useChatSend(client, true, "chat-a", chat, setChat, setError, attachmentsSupported),
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
    await expect(
      first.result.current.send({ text: "hello", attachments: [], cwd: "/project" }),
    ).rejects.toThrow("Connection closed");
  });
  first.unmount();
  const second = mount(client);
  await act(async () => {
    await second.result.current.send({ text: "hello", attachments: [], cwd: "/project" });
  });
  expect(sendChatMessage.mock.calls[1][0].messageId).toBe(
    sendChatMessage.mock.calls[0][0].messageId,
  );
  await act(async () => {
    await second.result.current.send({ text: "hello", attachments: [], cwd: "/project" });
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
    await hook.result.current.send({ text: "hello", attachments: [], cwd: "/project" });
  });
  const newer = { ...initial, title: "New binding" };
  act(() => hook.result.current.setChat(newer));
  await act(async () => {
    resolve({ chats: [initial] });
  });
  expect(hook.result.current.chat).toBe(newer);
  hook.unmount();
});

it("sends attachment-only content through chat and changes receipt when attachments change", async () => {
  const sendChatMessage = vi.fn().mockRejectedValueOnce(new Error("timeout")).mockResolvedValue({});
  const client = {
    sendChatMessage,
    listChats: async () => ({ chats: [initial] }),
  } as unknown as DaemonClient;
  const hook = mount(client);
  const payload = {
    text: "",
    cwd: "/project",
    attachments: [
      {
        kind: "workspace_file" as const,
        path: "/project/README.md",
        selection: { kind: "whole_file" as const },
      },
    ],
  };
  await act(async () => {
    await expect(hook.result.current.send(payload)).rejects.toThrow("timeout");
  });
  await act(async () => {
    await hook.result.current.send({
      ...payload,
      attachments: [{ ...payload.attachments[0], path: "/project/OTHER.md" }],
    });
  });
  expect(sendChatMessage.mock.calls[0][0]).toMatchObject({
    chatId: "chat-a",
    text: "",
    attachments: [expect.objectContaining({ type: "text" })],
  });
  expect(sendChatMessage.mock.calls[1][0].messageId).not.toBe(
    sendChatMessage.mock.calls[0][0].messageId,
  );
});

it("refuses retained attachment drafts on an older Host without silently stripping content", async () => {
  const sendChatMessage = vi.fn();
  const hook = mount({ sendChatMessage } as unknown as DaemonClient, false);
  await act(async () => {
    await expect(
      hook.result.current.send({
        text: "file",
        cwd: "/project",
        attachments: [
          { kind: "workspace_file", path: "/project/file", selection: { kind: "whole_file" } },
        ],
      }),
    ).rejects.toThrow("needs an update");
  });
  expect(sendChatMessage).not.toHaveBeenCalled();
});

it("encodes image-only content without treating attached /new text as a reset", async () => {
  const sendChatMessage = vi.fn().mockResolvedValue({});
  const resetChatSession = vi.fn();
  const client = {
    sendChatMessage,
    resetChatSession,
    listChats: async () => ({ chats: [initial] }),
  } as unknown as DaemonClient;
  const hook = mount(client);
  await act(async () => {
    await hook.result.current.send({
      text: "/new",
      cwd: "/project",
      attachments: [
        {
          kind: "image",
          metadata: {
            id: "image",
            mimeType: "image/png",
            storageType: "web-indexeddb",
            storageKey: "key",
            createdAt: 0,
          },
        },
      ],
    });
  });
  expect(sendChatMessage).toHaveBeenCalledWith(
    expect.objectContaining({ text: "/new", images: [{ data: "AA==", mimeType: "image/png" }] }),
  );
  expect(resetChatSession).not.toHaveBeenCalled();
});
