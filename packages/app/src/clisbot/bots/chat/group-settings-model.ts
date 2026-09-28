import type { ChatPayload } from "@getpaseo/protocol/chats/types";
import {
  CHAT_ROOM_INSTRUCTIONS_MAX_CHARS,
  type ChatUpdatePatch,
} from "@getpaseo/protocol/chats/rpc-schemas";
export interface GroupSettingsDraft {
  title: string;
  requireMention: boolean;
  /** Empty = the built-in default instructions. */
  roomInstructions: string;
}
export function openGroupSettingsDraft(chat: ChatPayload): GroupSettingsDraft {
  return {
    title: chat.title ?? "",
    requireMention: chat.rules.interaction?.requireMention ?? false,
    roomInstructions: chat.rules.room?.instructions ?? "",
  };
}
export function groupSettingsPatch(
  draft: GroupSettingsDraft,
  original: GroupSettingsDraft,
): ChatUpdatePatch | null {
  const title = draft.title.trim();
  if (title.length > 256) throw new Error("Use 256 characters or fewer for the group name.");
  const instructions = draft.roomInstructions.trim();
  if (instructions.length > CHAT_ROOM_INSTRUCTIONS_MAX_CHARS)
    throw new Error(
      `Use ${CHAT_ROOM_INSTRUCTIONS_MAX_CHARS} characters or fewer for the room instructions.`,
    );
  const patch: ChatUpdatePatch = {};
  if (title !== original.title.trim()) patch.title = title || null;
  if (draft.requireMention !== original.requireMention) patch.requireMention = draft.requireMention;
  if (instructions !== original.roomInstructions.trim())
    patch.roomInstructions = instructions || null;
  return Object.keys(patch).length ? patch : null;
}
/** Whether saving would change anything; an over-limit draft counts as a change to report. */
export function hasGroupSettingsChanges(
  draft: GroupSettingsDraft,
  original: GroupSettingsDraft,
): boolean {
  try {
    return groupSettingsPatch(draft, original) !== null;
  } catch {
    return true;
  }
}
