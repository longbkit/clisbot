import type { ChatPayload } from "@clisbot/protocol/chats/types";
import {
  CHAT_ROOM_INSTRUCTIONS_MAX_CHARS,
  type ChatUpdatePatch,
} from "@clisbot/protocol/chats/rpc-schemas";
import { DEFAULT_CHAT_ROUNDS_MAX } from "@clisbot/protocol/chats/room";
import { i18n } from "@/i18n/i18next";
export interface GroupSettingsDraft {
  title: string;
  requireMention: boolean;
  /** Empty = the built-in default instructions. */
  roomInstructions: string;
  /** How many rounds a discussion may run before the daemon stops it. */
  roundsMax: number;
}

export function openGroupSettingsDraft(chat: ChatPayload): GroupSettingsDraft {
  return {
    title: chat.title ?? "",
    requireMention: chat.rules.interaction?.requireMention ?? false,
    roomInstructions: chat.rules.room?.instructions ?? "",
    roundsMax: chat.rules.rounds?.max ?? DEFAULT_CHAT_ROUNDS_MAX,
  };
}
export function groupSettingsPatch(
  draft: GroupSettingsDraft,
  original: GroupSettingsDraft,
): ChatUpdatePatch | null {
  const title = draft.title.trim();
  if (title.length > 256) throw new Error(i18n.t("bots.chat.group.nameTooLong", { max: 256 }));
  const instructions = draft.roomInstructions.trim();
  if (instructions.length > CHAT_ROOM_INSTRUCTIONS_MAX_CHARS)
    throw new Error(
      i18n.t("bots.chat.group.instructionsTooLong", { max: CHAT_ROOM_INSTRUCTIONS_MAX_CHARS }),
    );
  const patch: ChatUpdatePatch = {};
  if (title !== original.title.trim()) patch.title = title || null;
  if (draft.requireMention !== original.requireMention) patch.requireMention = draft.requireMention;
  if (instructions !== original.roomInstructions.trim())
    patch.roomInstructions = instructions || null;
  if (draft.roundsMax !== original.roundsMax) patch.roundsMax = draft.roundsMax;
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
