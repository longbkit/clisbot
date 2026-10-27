import type { SessionActor } from "@clisbot/protocol/session-authorship";
import { isOwnActor, type HubAccountIdentity } from "@/clisbot/session-storage/actor-presentation";

/**
 * `unknown` is "cannot tell": the author is a Hub member but this device has no reader for that
 * Hub to compare with. It is never `mine` (that listed other members' work under For me).
 */
export type Ownership = "mine" | "others" | "unknown";
export type OwnershipScope = "mine" | "others" | "all";

/** A signed-in Hub account on this device, by origin. */
export interface ReaderAccount extends HubAccountIdentity {
  origin: string | null;
  /** Other addresses the same Hub is known by, such as a paired Hub's HTTPS route. */
  aliases?: readonly string[];
  /** The Hub's stable identity (`SessionActor.hubIdentity`); a paired Hub's `hub://<id>`. */
  hubId?: string;
}

/**
 * Who an item belongs to, from the author recorded today.
 *
 * - No author, a non-user author (automation, system) or a user author with no Hub origin (a
 *   direct connection, the device owner's): **mine**, as the brief's provisional rule.
 * - A Hub member whose Hub has a known reader on this device: **mine** when the reader made it,
 *   else **others**.
 * - A Hub member whose Hub has no known reader (not signed in, never signed in, or the account
 *   not resolved): **unknown**.
 *
 * `watched` is the Round 2 input; it already makes anything the reader's.
 */
export function resolveOwnership(input: {
  createdBy: SessionActor | null | undefined;
  accounts: readonly ReaderAccount[];
  watched?: boolean;
}): Ownership {
  if (input.watched) return "mine";
  const actor = input.createdBy;
  if (!actor || actor.kind !== "user") return "mine";
  // A snapshot without a Hub scope comes from a direct (no Hub) connection: the device owner's.
  if (!actor.hubOrigin && !actor.hubIdentity) return "mine";
  const account = input.accounts.find((candidate) => isSameHub(actor, candidate));
  if (!account?.id) return "unknown";
  // The Hub is matched; the address no longer needs to agree, whatever form each side wrote.
  return isOwnActor(actor, { ...account, origin: null }) ? "mine" : "others";
}

const PAIRED_HUB_SCHEME = "hub://";

/** Whether `actor` was stamped by the Hub `account` is signed in to. */
function isSameHub(actor: SessionActor, account: ReaderAccount): boolean {
  const hubId = account.hubId ?? hubIdOfOrigin(account.origin);
  if (actor.hubIdentity && hubId) return actor.hubIdentity === hubId;
  if (!actor.hubOrigin) return false;
  const origin = canonicalOrigin(actor.hubOrigin);
  return [account.origin, ...(account.aliases ?? [])].some(
    (known) => known !== null && canonicalOrigin(known) === origin,
  );
}

function hubIdOfOrigin(origin: string | null): string | undefined {
  return origin?.startsWith(PAIRED_HUB_SCHEME) ? origin.slice(PAIRED_HUB_SCHEME.length) : undefined;
}

/** `https://Hub.example:443/` and `https://hub.example` are one Hub. */
function canonicalOrigin(origin: string): string {
  try {
    const url = new URL(origin);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : origin;
  } catch {
    return origin;
  }
}

/** A Bot's direct chat is whoever's chat it is; before there is one, the Bot's owner decides. */
export function resolveDirectChatOwnership(
  input: {
    directChatCreatedBy: SessionActor | null | undefined;
    bot: { isOwner?: boolean; owner?: SessionActor };
  },
  accounts: readonly ReaderAccount[],
): Ownership {
  return input.directChatCreatedBy
    ? resolveOwnership({ createdBy: input.directChatCreatedBy, accounts })
    : resolveBotOwnership(input.bot, accounts);
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

/** `all` is the sum of the three: an `unknown` item is counted only there. */
export interface ScopeCounts {
  mine: number;
  others: number;
  unknown: number;
  all: number;
}

export const EMPTY_SCOPE_COUNTS: Readonly<ScopeCounts> = {
  mine: 0,
  others: 0,
  unknown: 0,
  all: 0,
};

export function countByScope(ownerships: Iterable<Ownership>): ScopeCounts {
  const counts = { ...EMPTY_SCOPE_COUNTS };
  for (const ownership of ownerships) {
    counts[ownership] += 1;
    counts.all += 1;
  }
  return counts;
}
