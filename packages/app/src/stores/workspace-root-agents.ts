import type { Agent } from "./session-store";
import { isWorkspaceRootAgent } from "@/subagents/workspace-root-policy";
import { normalizeWorkspaceOpaqueId } from "@/utils/workspace-identity";

/**
 * Normalized workspace id → the sessions its tab bar would open: unarchived root agents, oldest
 * first. One index per agents map, so a sidebar row reads its list instead of scanning the Host.
 */
export type WorkspaceRootAgents = ReadonlyMap<string, readonly Agent[]>;

type Agents = ReadonlyMap<string, Agent>;

const indexes = new WeakMap<Agents, WorkspaceRootAgents>();

export function workspaceRootAgentsOf(agents: Agents): WorkspaceRootAgents {
  const cached = indexes.get(agents);
  if (cached) return cached;
  const index = buildIndex(agents);
  indexes.set(agents, index);
  return index;
}

export function isWorkspaceSessionAgent(
  agent: Agent,
  agents: Agents,
  workspaceKey: string,
): boolean {
  if (agent.archivedAt || normalizeWorkspaceOpaqueId(agent.workspaceId) !== workspaceKey) {
    return false;
  }
  const parent = agent.parentAgentId ? agents.get(agent.parentAgentId) : undefined;
  return isWorkspaceRootAgent(agent, parent);
}

/**
 * Indexes `next` from `previous`'s index, rebuilding only the workspaces an agent entered, left or
 * changed in; untouched lists, and the whole index when none moved, keep their identity. Returns
 * the raw workspace ids touched, or null when `previous` was never indexed and `next` was built
 * from scratch.
 */
export function advanceWorkspaceRootAgents(previous: Agents, next: Agents): Set<string> | null {
  const before = indexes.get(previous);
  if (!before) {
    workspaceRootAgentsOf(next);
    return null;
  }
  const { touched, candidates } = touchedWorkspaces(previous, next);
  let after: Map<string, readonly Agent[]> | null = null;
  for (const key of new Set([...touched].map(normalizeWorkspaceOpaqueId))) {
    if (!key) continue;
    const current = before.get(key);
    const list = listWorkspace(next, key, [
      ...(current ?? []).map((entry) => entry.id),
      ...candidates,
    ]);
    if (sameAgents(current, list)) continue;
    after ??= new Map(before);
    if (list.length > 0) after.set(key, list);
    else after.delete(key);
  }
  indexes.set(next, after ?? before);
  return touched;
}

interface TouchedWorkspaces {
  touched: Set<string>;
  /** Changed agents and subagents of moved parents: the ids a touched list may gain. */
  candidates: string[];
}

function touchedWorkspaces(previous: Agents, next: Agents): TouchedWorkspaces {
  const touched = new Set<string>();
  const candidates: string[] = [];
  const moved = new Set<string>();
  function touch(id: string): void {
    const before = previous.get(id);
    const after = next.get(id);
    if (before?.workspaceId) touched.add(before.workspaceId);
    if (after?.workspaceId) touched.add(after.workspaceId);
    candidates.push(id);
    // Whether a subagent is a root depends on its parent's workspace.
    if (before?.workspaceId !== after?.workspaceId) moved.add(id);
  }
  for (const [id, agent] of next) if (previous.get(id) !== agent) touch(id);
  for (const id of previous.keys()) if (!next.has(id)) touch(id);
  if (moved.size === 0) return { touched, candidates };
  for (const agent of next.values()) {
    if (!agent.parentAgentId || !moved.has(agent.parentAgentId) || !agent.workspaceId) continue;
    touched.add(agent.workspaceId);
    candidates.push(agent.id);
  }
  return { touched, candidates };
}

function listWorkspace(agents: Agents, key: string, ids: readonly string[]): Agent[] {
  const list: Agent[] = [];
  for (const id of new Set(ids)) {
    const agent = agents.get(id);
    if (agent && isWorkspaceSessionAgent(agent, agents, key)) list.push(agent);
  }
  return list.sort(byCreation);
}

function buildIndex(agents: Agents): WorkspaceRootAgents {
  const index = new Map<string, Agent[]>();
  for (const agent of agents.values()) {
    const key = normalizeWorkspaceOpaqueId(agent.workspaceId);
    if (!key || !isWorkspaceSessionAgent(agent, agents, key)) continue;
    const list = index.get(key);
    if (list) list.push(agent);
    else index.set(key, [agent]);
  }
  for (const list of index.values()) list.sort(byCreation);
  return index;
}

function byCreation(left: Agent, right: Agent): number {
  return left.createdAt.getTime() - right.createdAt.getTime();
}

function sameAgents(left: readonly Agent[] | undefined, right: readonly Agent[]): boolean {
  if (!left) return right.length === 0;
  return left.length === right.length && left.every((agent, index) => agent === right[index]);
}
