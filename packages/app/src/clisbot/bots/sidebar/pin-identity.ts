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

/** Remember only aliases already proved for persisted pins; never catalog metadata or authority. */
export function createPinIdentityCatalog() {
  let principal: string | null = null;
  let aliases = new Map<string, PinChat>();
  return (
    scope: string,
    pins: readonly ResourcePin[],
    chats: readonly PinChat[],
  ): readonly PinChat[] => {
    if (scope !== principal) {
      aliases.clear();
      principal = scope;
    }
    const next = new Map<string, PinChat>();
    for (const pin of pins) {
      if (pin.kind !== "chat") continue;
      const key = JSON.stringify([pin.serverId, pin.id]);
      const current = chats.find((chat) => chat.serverId === pin.serverId && chat.id === pin.id);
      const canonical = canonicalPin(pin, chats);
      if (canonical.kind === "bot")
        next.set(key, {
          serverId: pin.serverId,
          id: pin.id,
          kind: "direct",
          participants: [{ botId: canonical.id, agentId: null }],
        });
      else if (!current && aliases.has(key)) next.set(key, aliases.get(key)!);
    }
    aliases = next;
    return [
      ...chats,
      ...[...aliases.values()].filter(
        (alias) => !chats.some((chat) => chat.serverId === alias.serverId && chat.id === alias.id),
      ),
    ];
  };
}
