import type { SessionActor } from "@clisbot/protocol/session-authorship";
import { isOwnActor, type HubAccountIdentity } from "@/clisbot/session-storage/actor-presentation";

export type Ownership = "mine" | "others";
export type OwnershipScope = "mine" | "others" | "all";

/** A signed-in Hub account on this device, by origin. */
export interface ReaderAccount extends HubAccountIdentity {
  origin: string | null;
}

/**
 * Who an item belongs to, from the author recorded today. Unknown authors are provisionally the
 * reader's (brief 1.3): no author, a non-user author, a direct-connection author without a Hub
 * origin, or a user from a Hub this device is not signed in to. `watched` is the Round 2 input; it already makes anything the reader's.
 */
export function resolveOwnership(input: {
  createdBy: SessionActor | null | undefined;
  accounts: readonly ReaderAccount[];
  watched?: boolean;
}): Ownership {
  if (input.watched) return "mine";
  const actor = input.createdBy;
  if (!actor || actor.kind !== "user") return "mine";
  const account = readerFor(actor, input.accounts);
  if (!account?.id) return "mine";
  return isOwnActor(actor, account) ? "mine" : "others";
}

function readerFor(actor: SessionActor, accounts: readonly ReaderAccount[]) {
  // A snapshot without an origin comes from a direct (no Hub) connection: the device owner's.
  if (!actor.hubOrigin) return undefined;
  return accounts.find((account) => account.origin === actor.hubOrigin);
}

/** A Bot row without a chat: the Host's own ownership projection wins over the owner snapshot. */
export function resolveBotOwnership(
  bot: { isOwner?: boolean; owner?: SessionActor },
  accounts: readonly ReaderAccount[],
): Ownership {
  if (bot.isOwner === true) return "mine";
  if (bot.isOwner === false) return "others";
  return resolveOwnership({ createdBy: bot.owner, accounts });
}

export function inScope(scope: OwnershipScope, ownership: Ownership): boolean {
  return scope === "all" || scope === ownership;
}

export interface ScopeCounts {
  mine: number;
  others: number;
  all: number;
}

export function countByScope(ownerships: Iterable<Ownership>): ScopeCounts {
  const counts = { mine: 0, others: 0, all: 0 };
  for (const ownership of ownerships) {
    counts[ownership] += 1;
    counts.all += 1;
  }
  return counts;
}
