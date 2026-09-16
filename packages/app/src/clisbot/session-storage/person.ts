import { useMemo } from "react";
import type { SessionActor } from "@getpaseo/protocol/session-authorship";
import { useHubAccount } from "@/clisbot/hub/account-provider";

const EMPTY_ROSTER: readonly RosterMember[] = [];

/** One row of the organization roster the Hub returns with the account state. */
export interface RosterMember {
  id: string;
  userId: string;
  name: string;
  email: string;
  image?: string | null;
}

/**
 * The person an actor snapshot names, as the Hub knows them now.
 *
 * A snapshot records who spoke and through which identity, frozen at that
 * moment. It is the only source when the reader cannot see the roster — signed
 * out, or looking at an organization they do not belong to — so it stays the
 * fallback rather than the primary.
 */
export interface PersonProfile {
  /**
   * The snapshot refreshed with what the Hub knows now — current name and image.
   * One object rather than loose fields, so a name and the monogram derived from
   * it can never come from different sources.
   */
  actor: SessionActor;
  /** The verified Member behind the snapshot, when the roster still lists them. */
  member: RosterMember | undefined;
}

const directories = new WeakMap<readonly RosterMember[], ReadonlyMap<string, RosterMember>>();

/** Cached on the roster array so a list of avatars indexes it once, not once per row. */
function membersById(roster: readonly RosterMember[]): ReadonlyMap<string, RosterMember> {
  const cached = directories.get(roster);
  if (cached) return cached;
  const built = new Map(roster.map((member) => [member.id, member]));
  directories.set(roster, built);
  return built;
}

export function resolvePersonProfile(
  actor: SessionActor,
  roster: readonly RosterMember[],
): PersonProfile {
  const member = actor.memberId ? membersById(roster).get(actor.memberId) : undefined;
  // Returning the snapshot itself keeps the reference stable for memoized rows.
  if (!member) return { actor, member: undefined };
  return {
    actor: {
      ...actor,
      ...(member.name ? { displayName: member.name } : {}),
      ...(member.image ? { avatarUrl: member.image } : {}),
    },
    member,
  };
}

/** The roster the signed-in reader can see; empty when Hub is off or signed out. */
export function useRoster(): readonly RosterMember[] {
  const { signedIn } = useHubAccount();
  return signedIn?.team?.members ?? EMPTY_ROSTER;
}

export function usePersonProfile(actor: SessionActor): PersonProfile {
  const roster = useRoster();
  return useMemo(() => resolvePersonProfile(actor, roster), [actor, roster]);
}
