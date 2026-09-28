import type { SessionActor } from "../session-authorship.js";
import type { ChatMessageSender } from "./types.js";

/** Chat and agent timelines carry the same user identity fields directly on sender. */
export function chatUserSender(
  actor: SessionActor | undefined,
): Extract<ChatMessageSender, { kind: "user" }> {
  return { ...actor, kind: "user" };
}

// COMPAT(chatSenderActor): v0.10.0-beta.1; keep until old hosts and transcripts are migrated.
// Normalize after validation, at the client and storage boundaries; never rewrite old journals.
export function normalizeChatSender(sender: ChatMessageSender): ChatMessageSender {
  if (sender.kind !== "user" || !sender.actor) return sender;
  const { actor, ...flat } = sender;
  // An explicit flat identity wins as a whole, so scopes from two actors are never mixed.
  return flat.id !== undefined ? flat : chatUserSender(actor);
}
