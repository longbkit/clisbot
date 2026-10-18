import type { DaemonClient } from "@clisbot/client/internal/daemon-client";
import type { ChatPayload } from "@clisbot/protocol/chats/types";
import type { MessagePayload } from "@/composer/types";
import { uploadLocalQueueCopies } from "@/composer/host-queue-content";
import { splitComposerAttachmentsForSubmit } from "@/composer/attachments/submit";
import { encodeImages } from "@/utils/encode-images";
import { resolveChatSendAction } from "./chat-send-action";

/** Canonical Chat handoff: normal composer and client queue share files, wire and receipt owner. */
export async function sendChatInput(input: {
  client: DaemonClient;
  serverId?: string;
  chat: ChatPayload;
  messageId: string;
  payload: MessagePayload;
  beforeSend?: () => void;
  freshFiles?: boolean;
}) {
  const values = await uploadLocalQueueCopies(
    input.client,
    input.payload.attachments,
    input.freshFiles,
  );
  const content = splitComposerAttachmentsForSubmit(values);
  const images = await encodeImages(content.images);
  const action = resolveChatSendAction({
    serverId: input.serverId,
    chat: input.chat,
    behavior: input.payload.activeTurnBehavior,
  });
  input.beforeSend?.();
  const result = await input.client.sendChatMessage({
    chatId: input.chat.id,
    text: input.payload.text,
    messageId: input.messageId,
    ...action,
    images,
    attachments: content.attachments,
  });
  if (result.error) throw new Error(result.error);
  return result;
}
