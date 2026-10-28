import type { SessionAuthorship } from "@clisbot/protocol/session-authorship";
import type { ChatPayload } from "@/clisbot/bots/data/contracts";
import { mergeParticipationKeys, participantIdentityKey } from "./ownership-key";

/** Bot participants point at already loaded sessions; no transcript fetch or creator inheritance. */
export function chatOwnershipEvidence(
  chat: ChatPayload,
  agents: ReadonlyMap<string, SessionAuthorship> | undefined,
) {
  const createdBy = chat.record?.createdBy;
  const participationKey = mergeParticipationKeys(
    chat.participants.map(({ agentId }) => {
      const agent = agentId ? agents?.get(agentId) : undefined;
      return agent ? participantIdentityKey(agent) : undefined;
    }),
  );
  return { createdBy, participationKey };
}
