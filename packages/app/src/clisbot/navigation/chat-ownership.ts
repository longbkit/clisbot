import type { SessionAuthorship } from "@clisbot/protocol/session-authorship";
import type { ChatPayload } from "@/clisbot/bots/data/contracts";
import { mergeParticipationKeys, participantIdentityKey } from "./ownership-key";

type Agents = ReadonlyMap<string, SessionAuthorship> | undefined;

/** Bot participants point at already loaded sessions; no transcript fetch or creator inheritance. */
export function chatOwnershipEvidence(chat: ChatPayload, agents: Agents) {
  return {
    createdBy: chat.record?.createdBy,
    participationKey: chatParticipationKey(chat, agents),
  };
}

interface CachedParticipation {
  agents: Agents;
  participants: readonly (SessionAuthorship | undefined)[];
  key: string | undefined;
}

/**
 * Keyed by the chat payload, so Home's pin tags and the Chats pane share one derivation. A session
 * store commit that leaves the Host's agents map alone costs a lookup; one that replaces it costs
 * a participant lookup, and the merge (JSON per participant) runs only when a participant moved.
 */
const participationByChat = new WeakMap<ChatPayload, CachedParticipation>();

function chatParticipationKey(chat: ChatPayload, agents: Agents): string | undefined {
  const cached = participationByChat.get(chat);
  if (cached && cached.agents === agents) return cached.key;
  const participants = chat.participants.map(({ agentId }) =>
    agentId ? agents?.get(agentId) : undefined,
  );
  if (cached && sameParticipants(cached.participants, participants)) {
    cached.agents = agents;
    return cached.key;
  }
  const key = mergeParticipationKeys(
    participants.map((agent) => (agent ? participantIdentityKey(agent) : undefined)),
  );
  participationByChat.set(chat, { agents, participants, key });
  return key;
}

function sameParticipants(
  a: readonly (SessionAuthorship | undefined)[],
  b: readonly (SessionAuthorship | undefined)[],
): boolean {
  return a.length === b.length && a.every((agent, index) => agent === b[index]);
}
