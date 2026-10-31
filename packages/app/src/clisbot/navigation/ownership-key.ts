import type { SessionActor, SessionAuthorship } from "@clisbot/protocol/session-authorship";
import type { ReaderAccount } from "./ownership";

/** Who a session's ownership is judged by: its creator and its already loaded senders. */
export interface OwnershipEvidence {
  createdBy?: SessionActor | null;
  participationKey?: string;
}

export interface OwnershipKeyInput {
  createdBy: SessionActor | null | undefined;
  participationKey?: string;
  /** The nearest ancestor's evidence; decides only when this session names no verified person. */
  inheritedOwnership?: OwnershipEvidence;
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

/** A Hub-stamped person: the only actor whose presence can place a session. */
export function isVerifiedPerson(actor: SessionActor | null | undefined): boolean {
  return actor?.kind === "user" && Boolean(actor.hubOrigin || actor.hubIdentity);
}

/** Whether `evidence` names a verified person, whoever is reading. */
export function hasVerifiedEvidence(evidence: OwnershipEvidence): boolean {
  if (isVerifiedPerson(evidence.createdBy)) return true;
  return evidence.participationKey
    ? actorsFromParticipationKey(evidence.participationKey).some(isVerifiedPerson)
    : false;
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
    ownershipEvidenceKey(input.inheritedOwnership),
  ]);
}

/** Identity of `evidence`, so equal evidence from replaced sources compares equal. */
export function ownershipEvidenceKey(evidence: OwnershipEvidence | undefined): string | undefined {
  if (!evidence) return undefined;
  return JSON.stringify([
    evidence.createdBy ? actorIdentity(evidence.createdBy) : null,
    evidence.participationKey,
  ]);
}
