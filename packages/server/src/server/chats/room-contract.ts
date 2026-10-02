// What a bot in a group chat is told about the room
// (docs/features/bots-and-chats/plans/group-discussion.md, "Room contract"). The frame is
// fixed because the engine reads its output: `PASS` is silence and `@slug` decides who
// wakes. Room instructions are the part the chat owner may change. Pure.
import { createHash } from "node:crypto";
import { DEFAULT_ROOM_INSTRUCTIONS, isSilentReply, PASS_REPLY } from "@clisbot/protocol/chats/room";

export { isSilentReply, PASS_REPLY };

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

/** Restates the current rules as well as the roster; resumed sessions keep their old system prompt. */
export function renderRoomUpdate(input: RoomContractInput): string {
  return [
    "[Room update] The room rules, members or instructions changed. They are now:",
    "",
    renderMembers(input.members),
    "",
    "These rules replace the previous room rules.",
    HOW_THIS_ROOM_WORKS,
    "",
    renderInstructions(input.instructions),
  ].join("\n");
}

/** Identifies what `renderRoomUpdate` would say, so a bot is told once per change. */
export function roomFingerprint(input: RoomContractInput): string {
  return createHash("sha256")
    .update(
      `${HOW_THIS_ROOM_WORKS}\n${renderMembers(input.members)}\n${instructionsOf(input.instructions)}`,
    )
    .digest("hex")
    .slice(0, 16);
}

/** Ends every wake in a discussion; the last round tells the room it is wrapping up. */
export function renderTurnCue(round: number, maxRounds: number): string {
  // A one-round limit must still invite an answer to the user's opening message.
  if (round > 1 && round >= maxRounds)
    return `[Your turn — last round] The discussion is wrapping up: reply only if it is essential, otherwise reply ${PASS_REPLY}.`;
  return `[Your turn — round ${round} of at most ${maxRounds}] Reply if you have something worth adding, otherwise reply ${PASS_REPLY}.`;
}

const HOW_THIS_ROOM_WORKS = [
  "How this room works:",
  "- A mention or a message to everyone is an invitation to speak, not an obligation.",
  "- Answer the user's message naturally. A greeting or casual conversation is worth answering;",
  "  do not wait for a question or a task in your role. You may also add new information, disagree, or take a step you own.",
  "- If another member already answered adequately and you have nothing useful to add,",
  `  or the message needs no reply, reply with exactly ${PASS_REPLY} and nothing else.`,
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
/** How much of a description each member's line carries; every bot's prompt repeats the roster. */
const ROLE_MAX_CHARS = 280;

function roleOf(member: RoomMember): string {
  const description = member.description?.trim().replace(/\s+/gu, " ") ?? "";
  if (description === "") return member.displayName;
  return description.length > ROLE_MAX_CHARS
    ? `${description.slice(0, ROLE_MAX_CHARS)}…`
    : description;
}
