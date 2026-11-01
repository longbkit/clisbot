import { afterEach, expect, it } from "vitest";
import type { DaemonClient } from "@clisbot/client/internal/daemon-client";
import type { ChatPayload } from "@clisbot/protocol/chats/types";
import { __setAttachmentStoreForTests } from "@/attachments/store";
import type { AttachmentMetadata, AttachmentStore } from "@/attachments/types";
import type { MessagePayload } from "@/composer/types";
import { sendChatInput } from "./send-chat-input";

const chat = { id: "chat", participants: [], rules: {} } as unknown as ChatPayload;

function image(id: string): MessagePayload["attachments"][number] {
  const metadata: AttachmentMetadata = {
    id,
    mimeType: "image/jpeg",
    storageType: "web-indexeddb",
    storageKey: id,
    createdAt: 1,
  };
  return { kind: "image", metadata };
}

afterEach(() => __setAttachmentStoreForTests(null));

function useIdentityStore() {
  __setAttachmentStoreForTests({
    encodeBase64: async ({ attachment }: { attachment: AttachmentMetadata }) => attachment.id,
  } as unknown as AttachmentStore);
}
const draft = (queueParts?: MessagePayload["queueParts"]) =>
  ({
    text: "Compare them",
    attachments: Array.from({ length: 33 }, (_, index) => image(`image-${index}`)),
    queueParts,
  }) as MessagePayload;

it("a Host with a queue takes the parts; nothing is sent as a later Chat message", async () => {
  useIdentityStore();
  const sendChatMessage = async () => {
    throw new Error("Wrong owner");
  };
  const counts: number[] = [];
  await sendChatInput({
    client: { sendChatMessage } as unknown as DaemonClient,
    chat,
    messageId: "message",
    payload: draft(async (parts) => {
      for (const part of parts) counts.push(part.images.length);
    }),
  });
  expect(counts).toEqual([17, 16]);
});

it("a Host without a queue gets ordered parts, retry-safe by derived ID", async () => {
  useIdentityStore();
  const sends: Array<{ messageId?: string; text: string; images?: unknown[] }> = [];
  const client = {
    sendChatMessage: async (params: (typeof sends)[number]) => {
      sends.push(params);
      return { error: null };
    },
  } as unknown as DaemonClient;
  await sendChatInput({
    client,
    chat,
    messageId: "message",
    payload: draft(),
  });
  expect(sends.map((send) => [send.messageId, send.images?.length])).toEqual([
    ["message-part-1", 17],
    ["message", 16],
  ]);
  expect(sends[1].text).toBe("Compare them");
});
