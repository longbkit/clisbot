import {
  sessionParticipantKey,
  sessionChannelKey,
  type SessionAuthorship,
  type SessionActor,
  type SessionChannelReference,
} from "@getpaseo/protocol/session-authorship";

export function copySessionMetadata(value: SessionAuthorship): SessionAuthorship {
  return {
    authorshipStatus: value.authorshipStatus,
    createdBy: value.createdBy,
    lastMessageBy: value.lastMessageBy,
    lastInteractionBy: value.lastInteractionBy,
    lastInteractionAt: value.lastInteractionAt,
    participantActors: value.participantActors,
    channels: value.channels,
  };
}

export function matchesSessionMetadata(
  workspace: SessionAuthorship,
  users: readonly string[],
  channels: readonly string[],
): boolean {
  const participants = [
    ...(workspace.participantActors ?? []),
    ...(workspace.createdBy ? [workspace.createdBy] : []),
  ];
  return (
    (users.length === 0 ||
      participants.some((actor) => users.includes(sessionParticipantKey(actor)))) &&
    (channels.length === 0 ||
      (workspace.channels ?? []).some((channel) => channels.includes(sessionChannelKey(channel))))
  );
}

export function sessionMetadataOptions(workspaces: Iterable<SessionAuthorship>): {
  users: Map<string, SessionActor>;
  channels: Map<string, SessionChannelReference>;
} {
  const users = new Map<string, SessionActor>();
  const channels = new Map<string, SessionChannelReference>();
  for (const workspace of workspaces) {
    for (const actor of workspace.participantActors ?? [])
      if (actor.kind === "user") users.set(sessionParticipantKey(actor), actor);
    if (workspace.createdBy?.kind === "user")
      users.set(sessionParticipantKey(workspace.createdBy), workspace.createdBy);
    for (const channel of workspace.channels ?? [])
      channels.set(sessionChannelKey(channel), channel);
  }
  return { users, channels };
}

export function sessionMetadataRecoveryNotice(
  workspaces: Iterable<SessionAuthorship>,
  filtered: boolean,
): string | null {
  let incomplete = false;
  let failed = false;
  for (const workspace of workspaces) {
    if (workspace.authorshipStatus === "error") failed = true;
    if (workspace.authorshipStatus && workspace.authorshipStatus !== "ready") incomplete = true;
  }
  if (!incomplete) return null;
  const message = failed
    ? "Some workspace metadata is unavailable."
    : "Workspace metadata is still loading.";
  return filtered ? `${message} Filter results may be incomplete.` : message;
}
