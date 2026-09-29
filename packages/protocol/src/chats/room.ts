// Room instructions every group bot reads when the chat owner has written none
// (docs/features/bots-and-chats/plans/group-discussion.md). The daemon puts them in the
// system prompt; the app shows them as the placeholder of the editable field.
export const DEFAULT_ROOM_INSTRUCTIONS = [
  "Work toward the outcome the user asked for, each member from their own role.",
  "Build on what others already said instead of repeating it.",
  "When the question is settled, the member who owns the next step says so briefly and the rest PASS.",
].join("\n");

/** Rounds a group discussion may run when the chat sets no `rounds.max`; a guard rail. */
export const DEFAULT_CHAT_ROUNDS_MAX = 5;

/** The reply a group bot gives when it has nothing to add; it is silence, never a transcript line. */
export const PASS_REPLY = "PASS";

/** A group turn that chose silence: no text, or exactly `PASS`. */
export function isSilentReply(text: string | null | undefined): boolean {
  const trimmed = text?.trim() ?? "";
  return trimmed === "" || trimmed === PASS_REPLY;
}
