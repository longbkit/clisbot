import { actorsFromParticipationKey, ownershipKey, type OwnershipKeyInput } from "./ownership-key";
import type { SessionActor } from "@clisbot/protocol/session-authorship";
import { isOwnActor, type HubAccountIdentity } from "@/clisbot/session-storage/actor-presentation";

/** Unproven ownership belongs to Others and All, never For me. */
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

export type OwnershipHostKind = "direct" | "hub" | "unknown";

/** Compatibility exception for manually paired Hosts; it is not proof of daemon ownership. */
export const KEEP_DIRECT_LEGACY_OWNERSHIP = true;

export type OwnershipInput = OwnershipKeyInput;

function actorOwnership(actor: SessionActor, accounts: readonly ReaderAccount[]): Ownership {
  if (actor.kind !== "user" || (!actor.hubOrigin && !actor.hubIdentity)) return "unknown";
  const account = accounts.find((candidate) => isSameHub(actor, candidate));
  if (!account?.id && !account?.memberId) return "unknown";
  // A channel identity is not a Hub user id: only its verified Member link proves a match.
  if (actor.connectionId && (!actor.memberId || !account.memberId)) return "others";
  return isOwnActor(actor, { ...account, origin: null }) ? "mine" : "others";
}

function classify(input: OwnershipInput, keepDirectLegacy: boolean): Ownership {
  if (input.hostKind === "unknown") return "unknown";
  if (input.watched) return "mine";
  const actor = input.createdBy;
  if (keepDirectLegacy && input.hostKind === "direct") {
    if (input.directOwner !== undefined) return input.directOwner ? "mine" : "others";
    if (!actor || actor.kind !== "user" || (!actor.hubOrigin && !actor.hubIdentity)) return "mine";
  }
  if (actor) return actorOwnership(actor, input.accounts);
  return input.participationKey &&
    actorsFromParticipationKey(input.participationKey).some(
      (participant) => actorOwnership(participant, input.accounts) === "mine",
    )
    ? "mine"
    : "unknown";
}

/** One bounded resolver for every surface; reader arrays are immutable identity snapshots. */
export function createOwnershipResolver(keepDirectLegacy = KEEP_DIRECT_LEGACY_OWNERSHIP) {
  const cache = new Map<string, Ownership>();
  return (input: OwnershipInput): Ownership => {
    const key = ownershipKey(input);
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    const ownership = classify(input, keepDirectLegacy);
    if (cache.size >= 2048) cache.delete(cache.keys().next().value!);
    cache.set(key, ownership);
    return ownership;
  };
}

export const resolveOwnership = createOwnershipResolver();

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

export type OwnershipContext = Pick<OwnershipInput, "accounts" | "hostKind">;

/** An existing direct chat decides even when its creator is absent. */
export function resolveDirectChatOwnership(
  input: {
    directChat?: { createdBy?: SessionActor; participationKey?: string };
    bot: { isOwner?: boolean; owner?: SessionActor };
  },
  context: OwnershipContext,
): Ownership {
  return input.directChat
    ? resolveOwnership({
        createdBy: input.directChat.createdBy,
        participationKey: input.directChat.participationKey,
        ...context,
      })
    : resolveBotOwnership(input.bot, context);
}

export function resolveBotOwnership(
  bot: { isOwner?: boolean; owner?: SessionActor },
  context: OwnershipContext,
): Ownership {
  return resolveOwnership({ createdBy: bot.owner, directOwner: bot.isOwner, ...context });
}

export function inScope(scope: OwnershipScope, ownership: Ownership): boolean {
  if (scope === "all") return true;
  return scope === "mine" ? ownership === "mine" : ownership !== "mine";
}

/** `all` is `mine` + `others`; work that cannot be told apart is counted under `others`. */
export interface ScopeCounts {
  mine: number;
  others: number;
  all: number;
}

export const EMPTY_SCOPE_COUNTS: Readonly<ScopeCounts> = { mine: 0, others: 0, all: 0 };

/** Adds one item to the counts of the scopes it is listed under. */
export function addToScopeCounts(counts: ScopeCounts, ownership: Ownership): void {
  counts[ownership === "mine" ? "mine" : "others"] += 1;
  counts.all += 1;
}

export function countByScope(ownerships: Iterable<Ownership>): ScopeCounts {
  const counts = { ...EMPTY_SCOPE_COUNTS };
  for (const ownership of ownerships) addToScopeCounts(counts, ownership);
  return counts;
}
