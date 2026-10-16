import type { SessionState } from "@/stores/session-store";
import { deriveSessionStatusBucket } from "@/clisbot/workspace-sessions/select-sessions";
import { aggregateSidebarStateBuckets } from "@/utils/sidebar-agent-state";

/** A DM or group uses the same pending-submission and permission state as its session tabs. */
export function selectChatStatusBucket(
  source: SessionState | undefined,
  agentIds: readonly string[],
) {
  return aggregateSidebarStateBuckets(
    agentIds.flatMap((id) => {
      const agent = source?.agents.get(id);
      return agent && !agent.archivedAt && source ? [deriveSessionStatusBucket(agent, source)] : [];
    }),
  );
}
