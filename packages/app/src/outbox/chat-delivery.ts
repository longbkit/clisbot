import type { DaemonClient } from "@clisbot/client/internal/daemon-client";
import type { ChatPayload } from "@clisbot/protocol/chats/types";
import { sendChatInput } from "@/clisbot/bots/chat/send-chat-input";
import type { QueueMessageParts } from "@/composer/types";
import { i18n } from "@/i18n/i18next";
import { useSessionStore } from "@/stores/session-store";
import { generateMessageId } from "@/types/stream";
import { releaseOutboxAttachments, retainOutboxAttachments } from "./attachment-retention";
import {
  classifyDeliveryError,
  HostUnreachableError,
  type DeliveryOutcome,
  type OutboxEntry,
} from "./model";
import { inDeliveryLane } from "./lane";
import { getOutboxEntry, useOutboxStore } from "./store";

type ChatEntry = OutboxEntry & { target: { kind: "chat" } };

interface ChatDeliveryContext {
  client?: DaemonClient | null;
  chat?: ChatPayload;
  queueParts?: QueueMessageParts;
}

export interface ChatSendRequest {
  serverId: string;
  /** The open chat's client; a retry later uses the session's current one. */
  client?: DaemonClient | null;
  chat: ChatPayload;
  text: string;
  attachments: OutboxEntry["attachments"];
  activeTurnBehavior?: OutboxEntry["activeTurnBehavior"];
  queueParts?: QueueMessageParts;
}

const inFlight = new Set<string>();

function sessionClient(serverId: string): DaemonClient | null {
  return useSessionStore.getState().sessions[serverId]?.client ?? null;
}

/** A retry outside the open chat reads the chat's current members and rules from its Host. */
async function loadChat(client: DaemonClient, chatId: string): Promise<ChatPayload> {
  const result = await client.listChats();
  if (result.error) throw new Error(result.error);
  const chat = result.chats.find((candidate) => candidate.id === chatId);
  if (!chat) throw new Error(i18n.t("bots.chat.send.chatUnavailable"));
  return chat;
}

/** The line shows in the press frame from the outbox; the Host's transcript line replaces it. */
export function startChatSend(request: ChatSendRequest): {
  clientMessageId: string;
  delivery: Promise<DeliveryOutcome>;
} {
  const entry: ChatEntry = {
    clientMessageId: generateMessageId(),
    target: { kind: "chat", serverId: request.serverId, chatId: request.chat.id },
    text: request.text,
    attachments: request.attachments,
    ...(request.activeTurnBehavior ? { activeTurnBehavior: request.activeTurnBehavior } : {}),
    createdAt: Date.now(),
    status: "sending",
  };
  retainOutboxAttachments(entry);
  useOutboxStore.getState().add(entry);
  return {
    clientMessageId: entry.clientMessageId,
    delivery: deliverChatEntry(entry, {
      client: request.client,
      chat: request.chat,
      queueParts: request.queueParts,
    }),
  };
}

async function deliverChatEntry(
  entry: ChatEntry,
  context: ChatDeliveryContext = {},
): Promise<DeliveryOutcome> {
  const id = entry.clientMessageId;
  if (inFlight.has(id)) return { kind: "sent" };
  inFlight.add(id);
  try {
    const outcome = await inDeliveryLane(entry.target, () => attemptChatDelivery(entry, context));
    return settleChatEntry(entry, outcome);
  } finally {
    inFlight.delete(id);
  }
}

async function attemptChatDelivery(
  entry: ChatEntry,
  context: ChatDeliveryContext,
): Promise<DeliveryOutcome> {
  try {
    const client = context.client ?? sessionClient(entry.target.serverId);
    if (!client) throw new HostUnreachableError();
    const chat = context.chat ?? (await loadChat(client, entry.target.chatId));
    await sendChatInput({
      client,
      serverId: entry.target.serverId,
      chat,
      messageId: entry.clientMessageId,
      payload: {
        text: entry.text,
        attachments: entry.attachments,
        cwd: "",
        ...(entry.activeTurnBehavior ? { activeTurnBehavior: entry.activeTurnBehavior } : {}),
        ...(context.queueParts ? { queueParts: context.queueParts } : {}),
      },
    });
    return { kind: "sent" };
  } catch (error) {
    return classifyDeliveryError(error, i18n.t("messageDelivery.hostUnreachable"));
  }
}

function settleChatEntry(entry: ChatEntry, outcome: DeliveryOutcome): DeliveryOutcome {
  const id = entry.clientMessageId;
  if (!getOutboxEntry(id)) return { kind: "sent" };
  if (outcome.kind === "sent") {
    // Keep the line on screen until the transcript line with this id replaces it.
    useOutboxStore.getState().accept(id);
    releaseOutboxAttachments(id);
    return outcome;
  }
  useOutboxStore.getState().markFailed(id, outcome.failure);
  return outcome;
}

export function retryChatSend(
  clientMessageId: string,
  chat?: ChatPayload,
): Promise<DeliveryOutcome> | null {
  const entry = getOutboxEntry(clientMessageId);
  if (entry?.target.kind !== "chat" || inFlight.has(clientMessageId)) return null;
  useOutboxStore.getState().markSending(clientMessageId);
  return deliverChatEntry({ ...(entry as ChatEntry), status: "sending" }, { chat });
}

export function discardChatSend(clientMessageId: string): void {
  if (getOutboxEntry(clientMessageId)?.target.kind !== "chat") return;
  useOutboxStore.getState().remove(clientMessageId);
  releaseOutboxAttachments(clientMessageId);
}

/** Chat entries on a Host that are due again: interrupted mid-send or waiting for the Host. */
export function dueChatEntries(serverId: string): string[] {
  return Object.values(useOutboxStore.getState().entries)
    .filter((entry) => entry.target.kind === "chat" && entry.target.serverId === serverId)
    .filter((entry) => !inFlight.has(entry.clientMessageId))
    .filter((entry) => entry.status === "sending" || entry.failure?.autoRetry === true)
    .sort((left, right) => left.createdAt - right.createdAt)
    .map((entry) => entry.clientMessageId);
}
