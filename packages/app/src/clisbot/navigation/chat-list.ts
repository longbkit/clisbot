import { countByScope, type Ownership, type OwnershipScope, type ScopeCounts } from "./ownership";
import { inScope } from "./ownership";

/** One row of the Chats list: a Bot's direct chat or a group chat (brief C3). */
export interface ChatListEntry<Bot = unknown, Group = unknown> {
  key: string;
  kind: "bot" | "group";
  serverId: string;
  title: string;
  /** Last activity; a Bot without a chat yet has none and sorts after every chat. */
  updatedAt?: string;
  pinned: boolean;
  /** Position among pins, oldest pin first; only set when pinned. */
  pinIndex?: number;
  ownership: Ownership;
  unread: boolean;
  company: boolean;
  bot?: Bot;
  group?: Group;
}

export type ChatsChip = "all" | "unread" | "bot" | "groups" | "personal" | "company";
export const CHATS_CHIPS: readonly ChatsChip[] = [
  "all",
  "unread",
  "bot",
  "groups",
  "personal",
  "company",
];

export function matchesChatsChip(entry: ChatListEntry, chip: ChatsChip): boolean {
  if (chip === "unread") return entry.unread;
  if (chip === "bot") return entry.kind === "bot";
  if (chip === "groups") return entry.kind === "group";
  if (chip === "personal") return !entry.company;
  if (chip === "company") return entry.company;
  return true;
}

export function matchesChatsSearch(entry: ChatListEntry, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  return !needle || entry.title.toLocaleLowerCase().includes(needle);
}

/** Newest activity first; ties and Bots without a chat fall back to their key, never arrival. */
export function compareByRecency(a: ChatListEntry, b: ChatListEntry): number {
  const byTime = (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
  return byTime || a.key.localeCompare(b.key);
}

/**
 * The visible list: scope, then chip and search, then pinned rows on top in pin order, then the
 * rest newest first. `held` is the order the reader is looking at: while it is held (the pointer or
 * a finger is on the list), rows already shown keep their places and only new rows enter at the top.
 */
export type ChatsSort = "recent" | "name";

export function compareByName(a: ChatListEntry, b: ChatListEntry): number {
  return a.title.localeCompare(b.title) || a.key.localeCompare(b.key);
}

export function orderChatList<T extends ChatListEntry>(input: {
  entries: readonly T[];
  scope: OwnershipScope;
  chip: ChatsChip;
  search: string;
  held?: readonly string[] | null;
  sort?: ChatsSort;
  /** Host filter; empty lists every Host. */
  serverIds?: readonly string[];
}): T[] {
  const hosts = input.serverIds ?? [];
  const visible = input.entries.filter(
    (entry) =>
      inScope(input.scope, entry.ownership) &&
      (hosts.length === 0 || hosts.includes(entry.serverId)) &&
      matchesChatsChip(entry, input.chip) &&
      matchesChatsSearch(entry, input.search),
  );
  const pinned = visible
    .filter((entry) => entry.pinned)
    .sort((a, b) => (a.pinIndex ?? 0) - (b.pinIndex ?? 0));
  const compare = input.sort === "name" ? compareByName : compareByRecency;
  const rest = visible.filter((entry) => !entry.pinned).sort(compare);
  const fresh = [...pinned, ...rest];
  if (!input.held) return fresh;
  return holdOrder(input.held, fresh);
}

/** Keeps known keys in their held order; new keys lead, in their fresh order. */
export function holdOrder<T extends { key: string }>(
  held: readonly string[],
  fresh: readonly T[],
): T[] {
  const position = new Map(held.map((key, index) => [key, index]));
  const known = fresh
    .filter((entry) => position.has(entry.key))
    .sort((a, b) => position.get(a.key)! - position.get(b.key)!);
  const arrived = fresh.filter((entry) => !position.has(entry.key));
  return [...arrived, ...known];
}

export function chatScopeCounts(entries: readonly ChatListEntry[]): ScopeCounts {
  return countByScope(entries.map((entry) => entry.ownership));
}

export type ChatsListItem<T extends ChatListEntry> =
  | { type: "entry"; key: string; entry: T }
  | { type: "heading"; key: string; kind: "bot" | "group" };

/**
 * The rows the list draws: one mixed list by default (brief C3), or, when the reader opts in,
 * Bot chats then groups under their headings, each keeping its own order.
 */
export function chatListItems<T extends ChatListEntry>(
  ordered: readonly T[],
  split: boolean,
): ChatsListItem<T>[] {
  const item = (entry: T): ChatsListItem<T> => ({ type: "entry", key: entry.key, entry });
  if (!split) return ordered.map(item);
  const items: ChatsListItem<T>[] = [];
  for (const kind of ["bot", "group"] as const) {
    const rows = ordered.filter((entry) => entry.kind === kind);
    if (!rows.length) continue;
    items.push({ type: "heading", key: `heading:${kind}`, kind }, ...rows.map(item));
  }
  return items;
}
