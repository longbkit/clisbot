import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import type { DirectoryHealth } from "@/hooks/use-directory-health";
import {
  type SidebarStateBucket,
  aggregateSidebarStateBuckets,
  deriveSidebarStateBucket,
} from "@/utils/sidebar-agent-state";
import { activityBucket, isUnreadReply } from "./activity";

/** Counts canonical Host/session identities, never sidebar representations or pin aliases. */
export function summarizeInboxActivity(
  agents: readonly AggregatedAgent[],
  health: DirectoryHealth,
) {
  let active = 0,
    needs = 0,
    unread = 0;
  const seen = new Set<string>();
  const buckets: SidebarStateBucket[] = [];
  for (const agent of agents) {
    const key = JSON.stringify([agent.serverId, agent.id]);
    if (agent.archivedAt || seen.has(key)) continue;
    seen.add(key);
    const activity = activityBucket(agent);
    if (activity === "active") active++;
    if (activity === "needs") needs++;
    if (isUnreadReply(agent)) unread++;
    buckets.push(
      deriveSidebarStateBucket({
        status: agent.status,
        requiresAttention: Boolean(agent.requiresAttention),
        attentionReason: agent.attentionReason ?? null,
        pendingPermissionCount: agent.pendingPermissionCount ?? 0,
      }),
    );
  }
  return {
    active,
    needs,
    unread,
    bucket: aggregateSidebarStateBuckets(buckets),
    complete: health.hasAcceptedResult,
    availability: health.status,
  };
}
export type InboxActivity = ReturnType<typeof summarizeInboxActivity>;
