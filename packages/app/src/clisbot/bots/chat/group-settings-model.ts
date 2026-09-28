import type { ChatPayload } from "@getpaseo/protocol/chats/types";
import type { ChatUpdatePatch } from "@getpaseo/protocol/chats/rpc-schemas";
export interface GroupSettingsDraft {
  title: string;
  requireMention: boolean;
}
export function openGroupSettingsDraft(chat: ChatPayload): GroupSettingsDraft {
  return {
    title: chat.title ?? "",
    requireMention: chat.rules.interaction?.requireMention ?? false,
  };
}
export function groupSettingsPatch(
  draft: GroupSettingsDraft,
  original: GroupSettingsDraft,
): ChatUpdatePatch | null {
  const title = draft.title.trim();
  if (title.length > 256) throw new Error("Use 256 characters or fewer for the group name.");
  const patch: ChatUpdatePatch = {};
  if (title !== original.title.trim()) patch.title = title || null;
  if (draft.requireMention !== original.requireMention) patch.requireMention = draft.requireMention;
  return Object.keys(patch).length ? patch : null;
}
