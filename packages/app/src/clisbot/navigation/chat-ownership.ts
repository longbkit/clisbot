import type { SessionAuthorship } from "@clisbot/protocol/session-authorship";
import type { ChatPayload } from "@/clisbot/bots/data/contracts";
import { mergeParticipationKeys, participantIdentityKey } from "./ownership-key";

type Agents = ReadonlyMap<string, SessionAuthorship & { followed?: boolean }> | undefined;

/** Bot participants point at already loaded sessions; no transcript fetch or creator inheritance. */
export function chatOwnershipEvidence(chat: ChatPayload, agents: Agents) {
  return {
    createdBy: chat.record?.createdBy,
    participationKey: chatParticipationKey(chat, agents),
    ...(chatFollowed(chat, agents) ? { watched: true } : {}),
  };
}

/** A chat is followed when the reader follows one of its sessions, as its notifications are. */
export function chatFollowed(chat: ChatPayload, agents: Agents): boolean {
  return chatParticipation(chat, agents).followed;
}

interface CachedParticipation {
  agents: Agents;
  participants: readonly (Participant | undefined)[];
  key: string | undefined;
  followed: boolean;
}

type Participant = SessionAuthorship & { followed?: boolean };

/**
 * Keyed by the chat payload, so Home's pin tags and the Chats pane share one derivation. A session
 * store commit that leaves the Host's agents map alone costs a lookup; one that replaces it costs
 * a participant lookup, and the merge (JSON per participant) runs only when a participant moved.
 */
const participationByChat = new WeakMap<ChatPayload, CachedParticipation>();

function chatParticipationKey(chat: ChatPayload, agents: Agents): string | undefined {
  return chatParticipation(chat, agents).key;
}

/** A followed participant is a new agent object, so the same identity check covers follows. */
function chatParticipation(chat: ChatPayload, agents: Agents): CachedParticipation {
  const cached = participationByChat.get(chat);
  if (cached && cached.agents === agents) return cached;
  const participants = chat.participants.map(({ agentId }) =>
    agentId ? agents?.get(agentId) : undefined,
  );
  if (cached && sameParticipants(cached.participants, participants)) {
    cached.agents = agents;
    return cached;
  }
  const key = mergeParticipationKeys(
    participants.map((agent) => (agent ? participantIdentityKey(agent) : undefined)),
  );
  const next = {
    agents,
    participants,
    key,
    followed: participants.some((agent) => agent?.followed === true),
  };
  participationByChat.set(chat, next);
  return next;
}

function sameParticipants(
  a: readonly (Participant | undefined)[],
  b: readonly (Participant | undefined)[],
): boolean {
  return a.length === b.length && a.every((agent, index) => agent === b[index]);
}
