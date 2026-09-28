// What a bot in a group chat is told about the room
// (docs/features/bots-and-chats/plans/group-discussion.md, "Room contract"). The frame is
// fixed because the engine reads its output: `PASS` is silence and `@slug` decides who
// wakes. Room instructions are the part the chat owner may change. Pure.
import { createHash } from "node:crypto";

/** The reply that means "nothing to add"; the engine appends no line for it. */
export const PASS_REPLY = "PASS";

/** Room instructions when the chat owner has written none. */
export const DEFAULT_ROOM_INSTRUCTIONS = [
  "Work toward the outcome the user asked for, each member from their own role.",
  "Build on what others already said instead of repeating it.",
  "When the question is settled, the member who owns the next step says so briefly and the rest PASS.",
].join("\n");

export interface RoomMember {
  slug: string;
  displayName: string;
  description?: string | null;
}

export interface RoomContractInput {
  chatTitle: string | null;
  /** The bot being prompted; also listed in `members`. */
  self: RoomMember;
  /** Every bot in the chat, in Members order. */
  members: readonly RoomMember[];
  /** The owner's room instructions; empty or missing means the default. */
  instructions?: string | null;
}

/** The system prompt a group-chat session starts with. */
export function renderRoomContract(input: RoomContractInput): string {
  const room = input.chatTitle ? ` "${input.chatTitle}"` : "";
  return [
    `You are ${input.self.displayName} (@${input.self.slug}) in the group chat${room}.`,
    `Your role: ${roleOf(input.self)}`,
    "",
    renderMembers(input.members),
    "",
    HOW_THIS_ROOM_WORKS,
    "",
    renderInstructions(input.instructions),
  ].join("\n");
}

/** Opens a wake after the members or room instructions changed since the bot last saw them. */
export function renderRoomUpdate(input: RoomContractInput): string {
  return [
    "[Room update] The members or room instructions changed. They are now:",
    "",
    renderMembers(input.members),
    "",
    renderInstructions(input.instructions),
  ].join("\n");
}

/** Identifies what `renderRoomUpdate` would say, so a bot is told once per change. */
export function roomFingerprint(input: RoomContractInput): string {
  return createHash("sha256")
    .update(`${renderMembers(input.members)}\n${instructionsOf(input.instructions)}`)
    .digest("hex")
    .slice(0, 16);
}

/** A turn that chose silence: no text, or exactly `PASS`. */
export function isSilentReply(text: string | null): boolean {
  return text === null || text.trim() === "" || text.trim() === PASS_REPLY;
}

const HOW_THIS_ROOM_WORKS = [
  "How this room works:",
  "- A mention or a message to everyone is an invitation to speak, not an obligation.",
  "- Speak only to answer a question aimed at you, add new information, disagree, or take a step you own.",
  `  Otherwise reply with exactly ${PASS_REPLY} and nothing else.`,
  "- Even when the user tagged only you, decide whether another member's role covers part of the request.",
  "  If so, tag them with their exact @slug and one concrete ask each.",
  "- Do not tag anyone for thanks, agreement or a passing reference. Never write @everyone.",
  "- Keep it short, one to three sentences, in the language the user writes in.",
  "- Stop as soon as the question is settled; the room has a limit on how long a discussion runs.",
].join("\n");

function renderMembers(members: readonly RoomMember[]): string {
  const lines = members.map(
    (member) => `- @${member.slug} — ${member.displayName} — ${roleOf(member)}`,
  );
  return ["Members of this chat (tag with the exact @slug):", ...lines].join("\n");
}

function renderInstructions(instructions: string | null | undefined): string {
  return [
    "Room instructions from the chat owner (if they conflict with the rules above, the rules win):",
    "<<<",
    instructionsOf(instructions),
    ">>>",
  ].join("\n");
}

function instructionsOf(instructions: string | null | undefined): string {
  const text = instructions?.trim() ?? "";
  return text === "" ? DEFAULT_ROOM_INSTRUCTIONS : text;
}

/** A bot without a description is known by its name only. */
function roleOf(member: RoomMember): string {
  const description = member.description?.trim() ?? "";
  return description === "" ? member.displayName : description;
}
