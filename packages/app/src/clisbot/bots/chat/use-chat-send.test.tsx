// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { beforeAll, expect, it, vi } from "vitest";
import { i18n } from "@/i18n/i18next";
import type { ChatPayload } from "@clisbot/protocol/chats/types";
import type { DaemonClient } from "@clisbot/client/internal/daemon-client";
import { useChatSend } from "./use-chat-send";
import { retryChatSend } from "@/outbox/chat-delivery";
import { useOutboxStore } from "@/outbox/store";
import { useSessionStore } from "@/stores/session-store";
vi.mock("@/attachments/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/attachments/service")>()),
  encodeImageMessagesForSend: async (images: Array<{ mimeType: string }>) =>
    images.length === 0
      ? []
      : [images.map((image) => ({ data: "AA==", mimeType: image.mimeType }))],
}));
vi.mock("../data/runtime", () => ({ refreshBotsAndChats: vi.fn() }));
// The copy under test is the English UI text.
beforeAll(() => i18n.changeLanguage("en"));
const initial = { id: "chat-a", participants: [] } as unknown as ChatPayload;
function mount(client: DaemonClient, attachmentsSupported = true) {
  return renderHook(() => {
    const [chat, setChat] = useState<ChatPayload | null>(initial);
    const [error, setError] = useState<string | null>(null);
    return {
      ...useChatSend(client, true, "chat-a", chat, setChat, setError, attachmentsSupported, "host"),
      chat,
      setChat,
      error,
    };
  });
}
it("keeps a failed send in the outbox and retries it under its original id", async () => {
  const sendChatMessage = vi
    .fn()
    .mockRejectedValueOnce(new Error("Connection closed"))
    .mockResolvedValue({});
  const client = {
    sendChatMessage,
    listChats: async () => ({ chats: [initial] }),
  } as unknown as DaemonClient;
  useSessionStore.getState().initializeSession("host", client);
  const first = mount(client);
  await act(async () => {
    // The press returns at once: the line owns the outcome, not the composer.
    await first.result.current.send({ text: "hello", attachments: [], cwd: "/project" });
  });
  await vi.waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(1));
  const id = sendChatMessage.mock.calls[0][0].messageId as string;
  await vi.waitFor(() => expect(useOutboxStore.getState().entries[id]?.status).toBe("failed"));
  first.unmount();
  await act(async () => {
    await retryChatSend(id, initial);
  });
  expect(sendChatMessage.mock.calls[1][0].messageId).toBe(id);
  expect(useOutboxStore.getState().entries[id]).toBeUndefined();
  const second = mount(client);
  await act(async () => {
    await second.result.current.send({ text: "hello", attachments: [], cwd: "/project" });
  });
  await vi.waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(3));
  // Pressing Send again is a new message, even with the same text.
  expect(sendChatMessage.mock.calls[2][0].messageId).not.toBe(id);
  second.unmount();
  useSessionStore.getState().clearSession("host");
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
    await hook.result.current.send(payload);
  });
  await act(async () => {
    await hook.result.current.send({
      ...payload,
      attachments: [{ ...payload.attachments[0], path: "/project/OTHER.md" }],
    });
  });
  await vi.waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(2));
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

const twoBots = {
  id: "chat-a",
  participants: [{ botId: "bot-a" }, { botId: "bot-b" }],
} as unknown as ChatPayload;

function mountWith(chat: ChatPayload, client: DaemonClient) {
  return renderHook(() => {
    const [current, setChat] = useState<ChatPayload | null>(chat);
    const [error, setError] = useState<string | null>(null);
    return {
      ...useChatSend(client, true, "chat-a", current, setChat, setError, true, "host"),
      error,
    };
  });
}

it("/new and /new with trailing spaces reset every Bot once and add no line", async () => {
  for (const text of ["/new", "/new   "]) {
    const resetChatSession = vi.fn(async (_params: unknown) => ({ error: null }));
    const sendChatMessage = vi.fn();
    const client = {
      resetChatSession,
      sendChatMessage,
      listChats: async () => ({ chats: [twoBots] }),
    } as unknown as DaemonClient;
    const hook = mountWith(twoBots, client);
    await act(async () => {
      await hook.result.current.send({ text, attachments: [], cwd: "/project" });
    });
    expect(resetChatSession.mock.calls.map(([params]) => params)).toEqual([
      { chatId: "chat-a", botId: "bot-a" },
      { chatId: "chat-a", botId: "bot-b" },
    ]);
    expect(sendChatMessage).not.toHaveBeenCalled();
    hook.unmount();
  }
});

it("a second fresh-session press while one runs joins it instead of resetting again", async () => {
  let finish!: () => void;
  const resetChatSession = vi.fn(
    () =>
      new Promise<{ error: null }>((resolve) => {
        finish = () => resolve({ error: null });
      }),
  );
  const chat = { id: "chat-a", participants: [{ botId: "bot-a" }] } as unknown as ChatPayload;
  const client = {
    resetChatSession,
    listChats: async () => ({ chats: [chat] }),
  } as unknown as DaemonClient;
  const hook = mountWith(chat, client);
  let first!: Promise<void>;
  let second!: Promise<void>;
  act(() => {
    first = hook.result.current.startFreshSession();
    second = hook.result.current.startFreshSession();
  });
  await act(async () => {
    finish();
    await Promise.all([first, second]);
  });
  expect(resetChatSession).toHaveBeenCalledTimes(1);
  // Once settled, a later press is a new reset.
  await act(async () => {
    const third = hook.result.current.startFreshSession();
    finish();
    await third;
  });
  expect(resetChatSession).toHaveBeenCalledTimes(2);
});

it("/new with arguments is an ordinary message for the Bot", async () => {
  const resetChatSession = vi.fn();
  const sendChatMessage = vi.fn(async () => ({}));
  const client = {
    resetChatSession,
    sendChatMessage,
    listChats: async () => ({ chats: [twoBots] }),
  } as unknown as DaemonClient;
  useSessionStore.getState().initializeSession("host", client);
  const hook = mountWith(twoBots, client);
  await act(async () => {
    await hook.result.current.send({ text: "/new later", attachments: [], cwd: "/project" });
  });
  await vi.waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(1));
  expect(resetChatSession).not.toHaveBeenCalled();
  useSessionStore.getState().clearSession("host");
});

it("a failed reset shows the error and leaves no reset in flight", async () => {
  const resetChatSession = vi
    .fn()
    .mockResolvedValueOnce({ error: "Bot is running" })
    .mockResolvedValue({ error: null });
  const client = {
    resetChatSession,
    listChats: async () => ({ chats: [initial] }),
  } as unknown as DaemonClient;
  const chat = { id: "chat-a", participants: [{ botId: "bot-a" }] } as unknown as ChatPayload;
  const hook = mountWith(chat, client);
  await act(async () => {
    await expect(hook.result.current.startFreshSession()).rejects.toThrow("Bot is running");
  });
  expect(hook.result.current.error).toContain("Bot is running");
  await act(async () => {
    await hook.result.current.startFreshSession();
  });
  expect(resetChatSession).toHaveBeenCalledTimes(2);
});
