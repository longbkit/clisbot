import { getActiveMessageSubmissions } from "@/composer/submission/model";
import { resolveWorkspaceAgentTabLabel } from "@/panels/agent-tab-label";
import type { Agent, SessionState } from "@/stores/session-store";
import { isWorkspaceRootAgent } from "@/subagents/policies";
import { resolveTurnPresentation } from "@/timeline/turn-liveness";
import { deriveSidebarStateBucket, type SidebarStateBucket } from "@/utils/sidebar-agent-state";
import { normalizeWorkspaceOpaqueId } from "@/utils/workspace-identity";

export type WorkspaceSessionSource = Pick<SessionState, "agents" | "messageSubmissions">;

/** One session line under a workspace row. `agent` is the store's reference, so memo can key on it. */
export interface WorkspaceSessionItem {
  agent: Agent;
  /** Null until the session has a name — see `resolveWorkspaceAgentTabLabel`. */
  title: string | null;
  statusBucket: SidebarStateBucket;
}

/**
 * The sessions a workspace's tab bar would auto-open: unarchived root agents of the workspace.
 * Creation order, so a line never jumps while you reach for it.
 */
export function listWorkspaceRootAgents(
  agents: ReadonlyMap<string, Agent> | undefined,
  workspaceId: string,
): Agent[] {
  if (!agents) return [];
  return [...agents.values()]
    .filter((agent) => isWorkspaceSessionAgent(agent, agents, workspaceId))
    .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
}

function isWorkspaceSessionAgent(
  agent: Agent,
  agents: ReadonlyMap<string, Agent>,
  workspaceId: string,
): boolean {
  const normalizedWorkspaceId = normalizeWorkspaceOpaqueId(workspaceId);
  if (agent.archivedAt || !normalizedWorkspaceId) return false;
  if (normalizeWorkspaceOpaqueId(agent.workspaceId) !== normalizedWorkspaceId) return false;
  const parent = agent.parentAgentId ? agents.get(agent.parentAgentId) : undefined;
  return isWorkspaceRootAgent(agent, parent);
}

/**
 * Whether `agentId` has a line under the workspace — the same rule `selectWorkspaceSessions`
 * lists by, for one agent. The row's selected fill asks this on every store change, so it looks
 * the agent up instead of listing the workspace.
 */
export function hasWorkspaceSessionLine(input: {
  source: WorkspaceSessionSource;
  workspaceId: string;
  agentId: string;
  activeOnly: boolean;
}): boolean {
  const agent = input.source.agents.get(input.agentId);
  if (!agent || !isWorkspaceSessionAgent(agent, input.source.agents, input.workspaceId)) {
    return false;
  }
  return !input.activeOnly || deriveSessionStatusBucket(agent, input.source) !== "done";
}

/**
 * The status an agent's tab shows. A just-sent message counts as running before the daemon opens
 * the turn — the same rule `selectAgentTurnPresentation` gives the tab — so a session line and its
 * tab never disagree, and Active sessions only never hides the session you just messaged.
 */
export function deriveSessionStatusBucket(
  agent: Agent,
  source: WorkspaceSessionSource,
): SidebarStateBucket {
  const hasActiveSubmission =
    getActiveMessageSubmissions(source.messageSubmissions.get(agent.id)).length > 0;
  const turnActive = resolveTurnPresentation(agent.turn, hasActiveSubmission).isActive;
  return deriveSidebarStateBucket({
    status: turnActive ? "running" : agent.status,
    pendingPermissionCount: agent.pendingPermissions.length,
    requiresAttention: agent.requiresAttention ?? false,
    attentionReason: agent.attentionReason ?? null,
  });
}

export function selectWorkspaceSessions(input: {
  source: WorkspaceSessionSource;
  workspaceId: string;
  activeOnly: boolean;
}): WorkspaceSessionItem[] {
  const sessions = listWorkspaceRootAgents(input.source.agents, input.workspaceId).map((agent) => ({
    agent,
    title: resolveWorkspaceAgentTabLabel(agent.title),
    statusBucket: deriveSessionStatusBucket(agent, input.source),
  }));
  return input.activeOnly
    ? sessions.filter((session) => session.statusBucket !== "done")
    : sessions;
}
