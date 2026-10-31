import type { Agent, WorkspaceDescriptor } from "@/stores/session-store";
import { isWorkspaceRootAgent } from "@/subagents/policies";
import { deriveSidebarStateBucket } from "./sidebar-agent-state";
import { advanceWorkspaceRootAgents, workspaceRootAgentsOf } from "@/stores/workspace-root-agents";
import { normalizeWorkspaceOpaqueId } from "./workspace-identity";

export interface WorkspaceAgentActivity {
  agentId: string;
  status: WorkspaceDescriptor["status"];
  enteredAt: Date | null;
}

function workspaceAgentStatus(agent: Agent): Agent["status"] {
  if (agent.turn.phase === "open") return "running";
  return agent.status === "running" ? "idle" : agent.status;
}

export function buildWorkspaceAgentActivityIndex(
  agents: ReadonlyMap<string, Agent>,
  previous?: ReadonlyMap<string, WorkspaceAgentActivity>,
): Map<string, WorkspaceAgentActivity> {
  const activityByWorkspaceId = new Map<string, WorkspaceAgentActivity>();
  const latestActivityAtByWorkspaceId = new Map<string, Date>();

  for (const agent of agents.values()) {
    const parentAgent = agent.parentAgentId ? agents.get(agent.parentAgentId) : undefined;
    if (agent.archivedAt || !agent.workspaceId || !isWorkspaceRootAgent(agent, parentAgent)) {
      continue;
    }

    const enteredAt = agent.attentionTimestamp ?? agent.updatedAt;
    const latestActivityAt = latestActivityAtByWorkspaceId.get(agent.workspaceId);
    if (latestActivityAt && enteredAt <= latestActivityAt) {
      continue;
    }
    latestActivityAtByWorkspaceId.set(agent.workspaceId, enteredAt);

    const status = deriveSidebarStateBucket({
      status: workspaceAgentStatus(agent),
      pendingPermissionCount: agent.pendingPermissions.length,
      requiresAttention: agent.requiresAttention,
      attentionReason: agent.attentionReason,
    });
    activityByWorkspaceId.set(agent.workspaceId, {
      agentId: agent.id,
      status,
      enteredAt,
    });
  }

  for (const [workspaceId, activity] of activityByWorkspaceId) {
    const previousActivity = previous?.get(workspaceId);
    if (
      previousActivity?.agentId === activity.agentId &&
      previousActivity.status === activity.status
    ) {
      activityByWorkspaceId.set(workspaceId, previousActivity);
    }
  }

  if (previous && areWorkspaceAgentActivityIndexesIdentical(previous, activityByWorkspaceId)) {
    return previous instanceof Map ? previous : new Map(previous);
  }
  return activityByWorkspaceId;
}

/**
 * Clisbot: the index for `next`, recomputing only the workspaces whose agents changed since
 * `previousAgents` (same rule as the full build). Returns `previous` when no activity moved.
 */
export function advanceWorkspaceAgentActivityIndex(
  previousAgents: ReadonlyMap<string, Agent>,
  next: ReadonlyMap<string, Agent>,
  previous: Map<string, WorkspaceAgentActivity>,
): Map<string, WorkspaceAgentActivity> {
  const touched = advanceWorkspaceRootAgents(previousAgents, next);
  if (!touched) return buildWorkspaceAgentActivityIndex(next, previous);
  const roots = workspaceRootAgentsOf(next);
  let advanced: Map<string, WorkspaceAgentActivity> | null = null;
  for (const workspaceId of touched) {
    const current = previous.get(workspaceId);
    const key = normalizeWorkspaceOpaqueId(workspaceId);
    const activity = key ? latestRootActivity(roots.get(key), workspaceId, current) : undefined;
    if (activity === current) continue;
    advanced ??= new Map(previous);
    if (activity) advanced.set(workspaceId, activity);
    else advanced.delete(workspaceId);
  }
  return advanced ?? previous;
}

function latestRootActivity(
  roots: readonly Agent[] | undefined,
  workspaceId: string,
  previous: WorkspaceAgentActivity | undefined,
): WorkspaceAgentActivity | undefined {
  let latest: Agent | undefined;
  for (const agent of roots ?? []) {
    if (agent.workspaceId !== workspaceId) continue;
    const enteredAt = agent.attentionTimestamp ?? agent.updatedAt;
    if (!latest || enteredAt > (latest.attentionTimestamp ?? latest.updatedAt)) latest = agent;
  }
  if (!latest) return undefined;
  const status = deriveSidebarStateBucket({
    status: workspaceAgentStatus(latest),
    pendingPermissionCount: latest.pendingPermissions.length,
    requiresAttention: latest.requiresAttention,
    attentionReason: latest.attentionReason,
  });
  if (previous?.agentId === latest.id && previous.status === status) return previous;
  return { agentId: latest.id, status, enteredAt: latest.attentionTimestamp ?? latest.updatedAt };
}

function areWorkspaceAgentActivityIndexesIdentical(
  previous: ReadonlyMap<string, WorkspaceAgentActivity>,
  next: ReadonlyMap<string, WorkspaceAgentActivity>,
): boolean {
  if (previous.size !== next.size) {
    return false;
  }
  for (const [workspaceId, activity] of next) {
    if (previous.get(workspaceId) !== activity) {
      return false;
    }
  }
  return true;
}
