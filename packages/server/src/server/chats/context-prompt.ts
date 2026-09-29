// What a bot receives for a turn (docs/features/bots-and-chats/plans/server-chat.md,
// §2.4): the same sender lines and context / message headers a channel session
// gets, rendered by the protocol's `renderConversationPrompt`. Pure.
import type { ChatMessagePayload, ChatMessageSender } from "@clisbot/protocol/chats/types";
import {
  renderConversationPrompt,
  type ConversationLine,
} from "@clisbot/protocol/conversation-prompt";

/** The identity and name of a participant, for the sender line. */
export type BotNameResolver = (botId: string) => { slug: string; displayName: string } | null;

export interface ChatPromptInput {
  /** The bot being prompted; its own output is never re-ingested as input. */
  botId: string;
  /** Lines since the bot's `deliveredSeq`, oldest first, already cut to `context.maxMessages`. */
  window: readonly ChatMessagePayload[];
  /** The lines this turn answers; always rendered even when the window cut them. */
  triggering: readonly ChatMessagePayload[];
  botOf: BotNameResolver;
}

/** `user:<actor.id>` / `bot:<slug>` / `system`, with the display name when known. */
export function senderLineOf(line: ChatMessagePayload, botOf: BotNameResolver): ConversationLine {
  return { ...senderOf(line.sender, botOf), text: line.text };
}

function senderOf(
  sender: ChatMessageSender,
  botOf: BotNameResolver,
): Pick<ConversationLine, "senderIdentity" | "senderName"> {
  switch (sender.kind) {
    case "user":
      return {
        senderIdentity: sender.id !== undefined ? `user:${sender.id}` : "user",
        senderName: sender.displayName,
      };
    case "bot": {
      const bot = botOf(sender.botId);
      return {
        senderIdentity: `bot:${bot?.slug ?? sender.botId}`,
        senderName: bot?.displayName,
      };
    }
    case "system":
      return { senderIdentity: "system" };
  }
}

/**
 * The prompt text. Context = the window minus the triggering lines; messages = the
 * triggering lines not written by the bot itself. Own output is excluded from both.
 * With only own-output triggers there is nothing to answer, so the engine sends nothing.
 */
export function renderChatPrompt(input: ChatPromptInput): string {
  const triggeringIds = new Set(input.triggering.map((line) => line.id));
  const messages = input.triggering.filter(
    (line) => !(line.sender.kind === "bot" && line.sender.botId === input.botId),
  );
  if (messages.length === 0) return "";
  const context = input.window.filter(
    (line) =>
      !triggeringIds.has(line.id) &&
      !(line.sender.kind === "bot" && line.sender.botId === input.botId),
  );
  return renderConversationPrompt({
    context: context.map((line) => senderLineOf(line, input.botOf)),
    messages: messages.map((line) => senderLineOf(line, input.botOf)),
  });
}

/** The daemon's limit on a title it derives from a first prompt. */
const SESSION_TITLE_MAX_CHARS = 60;

/**
 * A (bot, chat) session's title: the chat title, else the first line of the user's own
 * text, as the daemon would have named it from a bare prompt. Set at create because the
 * daemon otherwise titles an untitled agent from its first prompt, which is a sender line.
 */
export function sessionTitleFor(chatTitle: string | null, text: string): string | undefined {
  const line = (chatTitle ?? text)
    .split(/\r?\n/)
    .map((candidate) => candidate.replace(/\s+/g, " ").trim())
    .find((candidate) => candidate.length > 0);
  const title = line?.slice(0, SESSION_TITLE_MAX_CHARS).trim();
  return title === undefined || title === "" ? undefined : title;
}
