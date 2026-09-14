import {
  sessionActorKey,
  sessionChannelKey,
  type SessionActor,
  type SessionAuthorship,
  type SessionChannelReference,
} from "@getpaseo/protocol/session-authorship";

/** Metadata is a snapshot, not the current viewer, socket owner, or authorization. */
export function copySessionAuthorship(source: SessionAuthorship): SessionAuthorship {
  return {
    authorshipStatus: source.authorshipStatus,
    createdBy: source.createdBy,
    lastMessageBy: source.lastMessageBy,
    lastInteractionBy: source.lastInteractionBy,
    lastInteractionAt: source.lastInteractionAt,
    participantActors: source.participantActors,
    channels: source.channels,
  };
}

export interface SessionOperationIdentity {
  actor?: SessionActor;
  channel?: SessionChannelReference;
}

/** Link membership is historical participation; it does not change the raw actor/profile identity. */
function participationSnapshotKey(actor: SessionActor): string {
  return JSON.stringify([sessionActorKey(actor), actor.memberId ?? null]);
}

export function recordSessionInteraction(
  target: SessionAuthorship,
  interaction: SessionOperationIdentity & {
    timestamp: string;
    kind: "message" | "permission";
  },
): void {
  const { actor, channel, timestamp, kind } = interaction;
  if (actor) {
    const participants = new Map(
      (target.participantActors ?? []).map((entry) => [participationSnapshotKey(entry), entry]),
    );
    participants.set(participationSnapshotKey(actor), actor);
    target.participantActors = [...participants.values()];
  }
  if (channel) {
    const channels = new Map(
      (target.channels ?? []).map((entry) => [sessionChannelKey(entry), entry]),
    );
    channels.set(sessionChannelKey(channel), channel);
    target.channels = [...channels.values()];
  }
  if (!target.lastInteractionAt || timestamp > target.lastInteractionAt) {
    // An unknown last actor must clear the previous actor, never inherit it.
    target.lastInteractionAt = timestamp;
    target.lastInteractionBy = actor;
  }
  if (kind === "message") target.lastMessageBy = actor;
}

function newerSessionInteraction(
  session: SessionAuthorship & { id?: string },
  current: SessionAuthorship,
  lastSessionId: string,
): boolean {
  return Boolean(
    session.lastInteractionAt &&
    (!current.lastInteractionAt ||
      session.lastInteractionAt > current.lastInteractionAt ||
      (session.lastInteractionAt === current.lastInteractionAt &&
        (session.id ?? "") > lastSessionId)),
  );
}

/** Input must already be filtered to the viewer's authorized sessions. */
export function aggregateWorkspaceAuthorship(
  workspace: SessionAuthorship & { createdAt?: string },
  sessions: readonly (SessionAuthorship & { id?: string })[],
): SessionAuthorship & { createdAt?: string } {
  const result: SessionAuthorship & { createdAt?: string } = {
    createdBy: workspace.createdBy,
    createdAt: workspace.createdAt,
    participantActors: workspace.createdBy ? [workspace.createdBy] : [],
    channels: workspace.channels ?? [],
  };
  const participants = new Map<string, SessionActor>();
  const channels = new Map<string, SessionChannelReference>();
  if (workspace.createdBy)
    participants.set(participationSnapshotKey(workspace.createdBy), workspace.createdBy);
  for (const channel of workspace.channels ?? []) channels.set(sessionChannelKey(channel), channel);
  const statusPriority = { ready: 0, pending: 1, recovering: 2, error: 3 } as const;
  let latestSessionId = "";
  for (const session of sessions) {
    if (
      session.authorshipStatus &&
      statusPriority[session.authorshipStatus] > statusPriority[result.authorshipStatus ?? "ready"]
    )
      result.authorshipStatus = session.authorshipStatus;
    for (const actor of [
      session.createdBy,
      ...(session.participantActors ?? []),
      session.lastInteractionBy,
    ]) {
      if (actor) participants.set(participationSnapshotKey(actor), actor);
    }
    for (const channel of session.channels ?? []) channels.set(sessionChannelKey(channel), channel);
    // Cross-session ties have no global causal order. Lexical session ID is deterministic.
    if (newerSessionInteraction(session, result, latestSessionId)) {
      result.lastInteractionAt = session.lastInteractionAt;
      result.lastInteractionBy = session.lastInteractionBy;
      latestSessionId = session.id ?? "";
    }
  }
  result.participantActors = [...participants.values()];
  result.channels = [...channels.values()];
  if (result.authorshipStatus && result.authorshipStatus !== "ready") {
    result.lastInteractionBy = undefined;
    result.lastInteractionAt = undefined;
  }
  if (!result.lastInteractionAt) delete result.lastInteractionAt;
  return result;
}
