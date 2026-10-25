import type { Ownership, OwnershipScope } from "./ownership";
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
export function orderChatList<T extends ChatListEntry>(input: {
  entries: readonly T[];
  scope: OwnershipScope;
  chip: ChatsChip;
  search: string;
  held?: readonly string[] | null;
}): T[] {
  const visible = input.entries.filter(
    (entry) =>
      inScope(input.scope, entry.ownership) &&
      matchesChatsChip(entry, input.chip) &&
      matchesChatsSearch(entry, input.search),
  );
  const pinned = visible
    .filter((entry) => entry.pinned)
    .sort((a, b) => (a.pinIndex ?? 0) - (b.pinIndex ?? 0));
  const rest = visible.filter((entry) => !entry.pinned).sort(compareByRecency);
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

export function chatScopeCounts(entries: readonly ChatListEntry[]) {
  let mine = 0;
  for (const entry of entries) if (entry.ownership === "mine") mine += 1;
  return { mine, others: entries.length - mine, all: entries.length };
}
