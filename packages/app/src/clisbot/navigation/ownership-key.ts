import type { SessionActor, SessionAuthorship } from "@clisbot/protocol/session-authorship";
import type { ReaderAccount } from "./ownership";

export interface OwnershipKeyInput {
  createdBy: SessionActor | null | undefined;
  participationKey?: string;
  accounts: readonly ReaderAccount[];
  hostKind: "direct" | "hub" | "unknown";
  watched?: boolean;
  /** The legacy Bot projection is used only by the direct-Host compatibility exception. */
  directOwner?: boolean;
}

/** Identity only: profile edits must not invalidate ownership or directory projections. */
function actorIdentity(actor: SessionActor) {
  return [
    actor.kind,
    actor.id,
    actor.memberId,
    actor.hubOrigin,
    actor.hubIdentity,
    actor.connectionId,
  ];
}

const participationKeys = new WeakMap<SessionAuthorship, string | undefined>();

/** Already loaded senders only; never a session's creator or its parent resource's author. */
export function participantIdentityKey(source: SessionAuthorship): string | undefined {
  if (participationKeys.has(source)) return participationKeys.get(source);
  const actors = source.lastMessageBy
    ? [source.lastMessageBy, ...(source.participantActors ?? [])]
    : (source.participantActors ?? []);
  const identities = new Set(actors.map((actor) => JSON.stringify(actorIdentity(actor))));
  const key = identities.size ? JSON.stringify([...identities].sort()) : undefined;
  participationKeys.set(source, key);
  return key;
}

/** Every session can be relevant through its already loaded sender identities. */
export function participationKeyOf(source: SessionAuthorship): string | undefined {
  return participantIdentityKey(source);
}

export function actorsFromParticipationKey(key: string): SessionActor[] {
  return (JSON.parse(key) as string[]).map((identity) => {
    const [kind, id, memberId, hubOrigin, hubIdentity, connectionId] = JSON.parse(identity);
    return { kind, id, memberId, hubOrigin, hubIdentity, connectionId };
  });
}

export function mergeParticipationKeys(keys: readonly (string | undefined)[]): string | undefined {
  const identities = new Set(keys.flatMap((key) => (key ? (JSON.parse(key) as string[]) : [])));
  return identities.size ? JSON.stringify([...identities].sort()) : undefined;
}

const accountIdentities = new WeakMap<OwnershipKeyInput["accounts"], number>();
let nextAccountIdentity = 0;

/** Shared by resolvers and count caches; Host binding and reader changes invalidate results. */
export function ownershipKey(input: OwnershipKeyInput): string {
  let identity = accountIdentities.get(input.accounts);
  if (identity === undefined) {
    identity = ++nextAccountIdentity;
    accountIdentities.set(input.accounts, identity);
  }
  return JSON.stringify([
    input.createdBy ? actorIdentity(input.createdBy) : null,
    input.participationKey,
    identity,
    input.hostKind,
    input.watched === true,
    input.directOwner,
  ]);
}
