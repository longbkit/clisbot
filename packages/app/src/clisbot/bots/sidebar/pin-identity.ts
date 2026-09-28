import type { ChatPayload } from "../data/contracts";
import type { ResourcePin } from "./pins";
import { isDirectChat } from "./sidebar-model";

export type PinChat = Pick<ChatPayload, "id" | "kind" | "participants"> & { serverId: string };

/** A bot and its DM are one sidebar item; groups keep their own identity. */
export function canonicalPin(pin: ResourcePin, chats: readonly PinChat[]): ResourcePin {
  const chat =
    pin.kind === "chat"
      ? chats.find((row) => row.serverId === pin.serverId && row.id === pin.id)
      : undefined;
  const botId = chat && isDirectChat(chat) ? chat.participants[0]?.botId : undefined;
  return { kind: botId ? "bot" : pin.kind, serverId: pin.serverId, id: botId ?? pin.id };
}

/** Resolve old bookmarks lazily. Unknown/offline chat pins retain their original intent. */
export function normalizePins(
  pins: readonly ResourcePin[],
  chats: readonly PinChat[],
): ResourcePin[] {
  const seen = new Set<string>();
  return pins.flatMap((pin) => {
    const resolved = canonicalPin(pin, chats);
    const key = JSON.stringify([resolved.kind, resolved.serverId, resolved.id]);
    if (seen.has(key)) return [];
    seen.add(key);
    return [resolved];
  });
}
