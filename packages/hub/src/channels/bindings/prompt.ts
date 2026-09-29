// What an Agent receives from a channel. The sender line and the context /
// message headers live in the protocol package so the daemon's chat engine
// renders the same shape (`@clisbot/protocol/conversation-prompt`); this file
// keeps the Hub-only parts: the delivery receipt key and the session title.
import { createHash } from "node:crypto";
import { channelMessageId } from "../daemon/session-operation.js";
import type { InboundMessage } from "../plane/types.js";

export {
  CONTEXT_HEADER,
  MESSAGE_HEADER,
  renderConversationPrompt,
  senderLabel,
  type ConversationPrompt,
} from "@clisbot/protocol/conversation-prompt";

/**
 * The daemon receipt key of a delivery. One message keeps the key it has on
 * every path (`channelMessageId`), so a batch of one and a direct send are the
 * same request. A batch is keyed by the platform messages it carries, in order:
 * replaying the same batch is the same request, and a message is never part of
 * two different keys that both reach the session.
 */
export function deliveryMessageId(messages: readonly InboundMessage[]): string {
  const ids = messages.map(channelMessageId);
  if (ids.length === 1) return ids[0]!;
  return createHash("sha256")
    .update(JSON.stringify(["batch", ...ids]))
    .digest("hex");
}

/** The daemon's limit on a title it derives from a first prompt. */
const SESSION_TITLE_MAX_CHARS = 60;

/**
 * A channel session's title: the first line of the trigger's own text, as the
 * daemon would have named it from a bare prompt (`create-agent-title.ts`). Set
 * at create because the daemon otherwise names an untitled Agent from its first
 * prompt, which is now a sender line or the context header.
 */
export function sessionTitle(text: string): string | undefined {
  const line = text
    .split(/\r?\n/)
    .map((candidate) => candidate.replace(/\s+/g, " ").trim())
    .find((candidate) => candidate.length > 0);
  const title = line?.slice(0, SESSION_TITLE_MAX_CHARS).trim();
  return title === undefined || title === "" ? undefined : title;
}
