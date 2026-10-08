import type { AgentToolGroup } from "@clisbot/protocol/connectors/agent-tools";
import { agentToolGroupOffKey, agentToolOffKey } from "@clisbot/protocol/connectors/agent-tools";
import type { ConnectorGrant } from "@clisbot/protocol/connectors/types";
import { i18n } from "@/i18n/i18next";
import type { AgentToolDefaults } from "./agent-tools-model";
import { sessionKeptTools, type SessionToolSet } from "./session-connectors";
import { sessionTools, type SessionConnector } from "./session-tools";

/**
 * What a group chat's Bots can use, merged (docs/features/connectors/README.md, "In a Chat"): the
 * tools any Bot in the room has, each with the Bots that have it. Bots can ask each other for
 * help, so what the room can do is what its Bots can do together; the room's switches take a
 * tool away from all of them at once and never give one a Bot lacks.
 */

export interface RoomBot {
  name: string;
  grant: ConnectorGrant | undefined;
}

export interface RoomGroup {
  group: AgentToolGroup;
  /** Every tool some Bot here has, with the room's keys. */
  set: SessionToolSet;
  /** Tool → the Bots that have it. */
  holders: ReadonlyMap<string, readonly string[]>;
  /** The Bots that have any tool of the group. */
  bots: readonly string[];
}

export interface RoomConnector extends SessionConnector {
  /** The Bots whose settings give this app or server, with how. */
  holders: readonly { name: string; grant: ConnectorGrant | undefined }[];
}

export interface RoomTools {
  groups: RoomGroup[];
  connectors: RoomConnector[];
}

function addHolder(map: Map<string, string[]>, key: string, name: string) {
  const names = map.get(key) ?? [];
  if (!names.includes(name)) names.push(name);
  map.set(key, names);
}

export function roomTools(bots: readonly RoomBot[], defaults: AgentToolDefaults | undefined) {
  const perBot = bots.map((bot) => ({ bot, tools: sessionTools(bot.grant, defaults) }));
  const groups = new Map<string, { group: AgentToolGroup; holders: Map<string, string[]> }>();
  const connectors = new Map<string, RoomConnector>();
  for (const { bot, tools } of perBot) {
    for (const entry of tools.groups) {
      const room = groups.get(entry.group.id) ?? { group: entry.group, holders: new Map() };
      for (const tool of entry.set.given) addHolder(room.holders, tool, bot.name);
      groups.set(entry.group.id, room);
    }
    for (const entry of tools.connectors) {
      const room = connectors.get(entry.key) ?? { ...entry, holders: [] };
      connectors.set(entry.key, { ...room, holders: [...room.holders, bot] });
    }
  }
  const roomGroups = [...groups.values()]
    .filter((room) => room.holders.size > 0)
    .map((room) => ({
      group: room.group,
      holders: room.holders,
      bots: [...new Set([...room.holders.values()].flat())],
      set: {
        wholeKey: agentToolGroupOffKey(room.group.id),
        keyOf: agentToolOffKey,
        given: room.group.tools.map((tool) => tool.name).filter((name) => room.holders.has(name)),
      },
    }));
  return { groups: roomGroups, connectors: [...connectors.values()] } satisfies RoomTools;
}

/** "test", "test and writer", "3 Bots". */
export function botsLabel(names: readonly string[]): string {
  if (names.length > 2) return i18n.t("connectors.tools.room.manyBots", { count: names.length });
  const [first = "", second] = names;
  return second === undefined ? first : i18n.t("connectors.tools.room.twoBots", { first, second });
}

/** How many groups and Connectors the room keeps on, for the chip. */
export function roomOnCount(room: RoomTools, off: ReadonlySet<string>): number {
  const groups = room.groups.filter((entry) => sessionKeptTools(entry.set, off).length > 0).length;
  return groups + room.connectors.filter((entry) => !off.has(entry.key)).length;
}
