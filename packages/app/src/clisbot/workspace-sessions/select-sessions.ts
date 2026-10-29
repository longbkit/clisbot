import { getActiveMessageSubmissions } from "@/composer/submission/model";
import { resolveWorkspaceAgentTabLabel } from "@/panels/agent-tab-label";
import type { Agent, SessionState } from "@/stores/session-store";
import { isWorkspaceSessionAgent, workspaceRootAgentsOf } from "@/stores/workspace-root-agents";
import { resolveTurnPresentation } from "@/timeline/turn-liveness";
import { deriveSidebarStateBucket, type SidebarStateBucket } from "@/utils/sidebar-agent-state";
import { normalizeWorkspaceOpaqueId } from "@/utils/workspace-identity";
import { withoutLiveFacts } from "@/clisbot/navigation/source-liveness";

export type WorkspaceSessionSource = Pick<SessionState, "agents" | "messageSubmissions"> & {
  /** The source is out of reach: its sessions keep their last facts but nothing live. */
  cached?: boolean;
};

/** One session line under a workspace row. `agent` is the store's reference, so memo can key on it. */
export interface WorkspaceSessionItem {
  agent: Agent;
  /** Null until the session has a name — see `resolveWorkspaceAgentTabLabel`. */
  title: string | null;
  statusBucket: SidebarStateBucket;
  /** Its live state was dropped because the source is out of reach: unknown, not finished. */
  unverified?: boolean;
}

const NO_AGENTS: readonly Agent[] = [];

/**
 * The sessions a workspace's tab bar would auto-open: unarchived root agents of the workspace.
 * Creation order, so a line never jumps while you reach for it. The list is the store's index
 * entry: the same array until one of the workspace's agents changes.
 */
export function listWorkspaceRootAgents(
  agents: ReadonlyMap<string, Agent> | undefined,
  workspaceId: string,
): readonly Agent[] {
  const key = normalizeWorkspaceOpaqueId(workspaceId);
  if (!agents || !key) return NO_AGENTS;
  return workspaceRootAgentsOf(agents).get(key) ?? NO_AGENTS;
}

function isWorkspaceSessionLineAgent(
  agent: Agent,
  agents: ReadonlyMap<string, Agent>,
  workspaceId: string,
): boolean {
  const key = normalizeWorkspaceOpaqueId(workspaceId);
  return key !== null && isWorkspaceSessionAgent(agent, agents, key);
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
  keepAgentIds?: ReadonlySet<string>;
}): boolean {
  const agent = input.source.agents.get(input.agentId);
  if (!agent || !isWorkspaceSessionLineAgent(agent, input.source.agents, input.workspaceId)) {
    return false;
  }
  const status = deriveSessionStatus(agent, input.source);
  return passesActiveOnly(input, agent.id, status.bucket, status.unverified);
}

/**
 * Active sessions only hides the `done` sessions, except one a pane is showing: opening a
 * session marks it read, and the line you just pressed must not vanish under you. It goes once
 * you move on.
 */
function passesActiveOnly(
  input: { activeOnly: boolean; keepAgentIds?: ReadonlySet<string> },
  agentId: string,
  bucket: SidebarStateBucket,
  unverified = false,
): boolean {
  // A session whose live state is unknown is not "done".
  return (
    !input.activeOnly ||
    bucket !== "done" ||
    unverified ||
    (input.keepAgentIds?.has(agentId) ?? false)
  );
}

/**
 * The status an agent's tab shows. A just-sent message counts as running before the daemon opens
 * the turn — the same rule `selectAgentTurnPresentation` gives the tab — so a session line and its
 * tab never disagree, and Active sessions only never hides the session you just messaged.
 */
export function deriveSessionStatusBucket(
  agent: Agent,
  source: SessionStatusSource,
): SidebarStateBucket {
  return deriveSessionStatus(agent, source).bucket;
}

/** What a session's status reads besides the agent itself. */
export type SessionStatusSource = Pick<WorkspaceSessionSource, "messageSubmissions" | "cached">;

/** The bucket, and whether it is `unverified`: a cached source's running turn or approval was dropped. */
export function deriveSessionStatus(
  agent: Agent,
  source: SessionStatusSource,
): { bucket: SidebarStateBucket; unverified: boolean } {
  const hasActiveSubmission =
    getActiveMessageSubmissions(source.messageSubmissions.get(agent.id)).length > 0;
  const turnActive = resolveTurnPresentation(agent.turn, hasActiveSubmission).isActive;
  const facts = {
    status: turnActive ? ("running" as const) : agent.status,
    pendingPermissionCount: agent.pendingPermissions.length,
    requiresAttention: agent.requiresAttention ?? false,
    attentionReason: agent.attentionReason ?? null,
  };
  const shown = source.cached ? withoutLiveFacts(facts) : facts;
  return { bucket: deriveSidebarStateBucket(shown), unverified: shown !== facts };
}

interface WorkspaceSessionsQuery {
  activeOnly: boolean;
  /** Sessions a pane shows, kept by Active sessions only — see `passesActiveOnly`. */
  keepAgentIds?: ReadonlySet<string>;
  /** The list owner's own rule (Navigation V2's Workspace scope); absent lists every line. */
  include?: (session: WorkspaceSessionItem) => boolean;
}

export function selectWorkspaceSessions(
  input: WorkspaceSessionsQuery & { source: WorkspaceSessionSource; workspaceId: string },
): WorkspaceSessionItem[] {
  return describeWorkspaceSessions({
    ...input,
    agents: listWorkspaceRootAgents(input.source.agents, input.workspaceId),
  });
}

/** The lines for a workspace's root agents, as `listWorkspaceRootAgents` lists them. */
export function describeWorkspaceSessions(
  input: WorkspaceSessionsQuery & {
    agents: readonly Agent[];
    source: SessionStatusSource;
  },
): WorkspaceSessionItem[] {
  const sessions = input.agents.map((agent) => {
    const status = deriveSessionStatus(agent, input.source);
    const item: WorkspaceSessionItem = {
      agent,
      title: resolveWorkspaceAgentTabLabel(agent.title),
      statusBucket: status.bucket,
    };
    if (status.unverified) item.unverified = true;
    return item;
  });
  return sessions.filter(
    (session) =>
      passesActiveOnly(input, session.agent.id, session.statusBucket, session.unverified) &&
      (input.include?.(session) ?? true),
  );
}
