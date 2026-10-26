import { foldSearchText, projectNameKey } from "./model";

/**
 * Everything search can scope to, built once per open and per directory change — never per
 * keystroke. Pure: the React glue in `use-search-scope.ts` feeds it.
 */

export type ScopeHostStatus = "online" | "connecting" | "offline";

export interface ScopeHostInput {
  serverId: string;
  label: string;
  /** This computer's daemon. */
  local: boolean;
  hubOrigin: string | null;
  hubName: string | null;
  /** Connection hostnames (TCP endpoint host, SSH host), so a typed address finds the Host. */
  hostnames: readonly string[];
  status: ScopeHostStatus;
  lastOnlineAt: string | null;
}

/** One project on one Host. */
export interface ScopeProjectInput {
  viewKey: string;
  serverId: string;
  projectName: string;
  customName: string | null;
  repoRoot: string;
  workspaceIds: readonly string[];
}

export interface ScopeAgentInput {
  serverId: string;
  workspaceId: string | null;
  cwd: string;
  placementProjectName: string | null;
}

export interface ScopeHost extends ScopeHostInput {
  /** A short serverId, set only when another Host has the same label and the same source. */
  shortId: string | null;
  fields: readonly string[];
  projectKeys: ReadonlySet<string>;
  sessionCount: number;
}

export interface ScopeHub {
  origin: string;
  name: string;
  serverIds: readonly string[];
  onlineCount: number;
  fields: readonly string[];
}

export interface ScopeProject {
  key: string;
  label: string;
  viewKeys: ReadonlySet<string>;
  /** Hosts carrying the project, in label order. */
  serverIds: readonly string[];
  sessionCount: number;
  sessionCountByServerId: ReadonlyMap<string, number>;
  fields: readonly string[];
}

export interface SearchScopeCatalog {
  hosts: readonly ScopeHost[];
  hostById: ReadonlyMap<string, ScopeHost>;
  hubs: readonly ScopeHub[];
  hubByOrigin: ReadonlyMap<string, ScopeHub>;
  projects: readonly ScopeProject[];
  projectByKey: ReadonlyMap<string, ScopeProject>;
  serverIdsByHub: ReadonlyMap<string, readonly string[]>;
  projectKeyByViewKey: ReadonlyMap<string, string>;
  projectKeyOfWorkspace(serverId: string, workspaceId: string): string | null;
  projectKeyOfAgent(agent: ScopeAgentInput): string | null;
}

function basename(path: string): string {
  return /([^\\/]+)[\\/]*$/.exec(path)?.[1] ?? "";
}

function workspaceKey(serverId: string, workspaceId: string): string {
  return `${serverId}\u0000${workspaceId}`;
}

interface ProjectDraft {
  key: string;
  labels: Map<string, number>;
  viewKeys: Set<string>;
  serverIds: Set<string>;
  fields: Set<string>;
}

function draftProjects(projects: readonly ScopeProjectInput[]) {
  const drafts = new Map<string, ProjectDraft>();
  const keyByWorkspace = new Map<string, string>();
  const rootsByServerId = new Map<string, { root: string; key: string }[]>();
  for (const project of projects) {
    const key = projectNameKey(project.projectName);
    if (!key) continue;
    let draft = drafts.get(key);
    if (!draft) {
      draft = {
        key,
        labels: new Map(),
        viewKeys: new Set(),
        serverIds: new Set(),
        fields: new Set(),
      };
      drafts.set(key, draft);
    }
    draft.labels.set(project.projectName, (draft.labels.get(project.projectName) ?? 0) + 1);
    draft.viewKeys.add(project.viewKey);
    draft.serverIds.add(project.serverId);
    for (const field of [project.projectName, project.customName, basename(project.repoRoot)]) {
      if (field) draft.fields.add(foldSearchText(field));
    }
    for (const id of project.workspaceIds)
      keyByWorkspace.set(workspaceKey(project.serverId, id), key);
    if (project.repoRoot) {
      const roots = rootsByServerId.get(project.serverId) ?? [];
      roots.push({ root: project.repoRoot.replace(/[\\/]+$/, ""), key });
      rootsByServerId.set(project.serverId, roots);
    }
  }
  // Longest root first, so a nested repo wins over the one containing it.
  for (const roots of rootsByServerId.values()) roots.sort((a, b) => b.root.length - a.root.length);
  return { drafts, keyByWorkspace, rootsByServerId };
}

/** The label most Hosts use, so one renamed copy does not rename the merged row. */
function dominantLabel(labels: ReadonlyMap<string, number>): string {
  let best = "";
  let bestCount = 0;
  for (const [label, count] of labels) {
    if (count > bestCount || (count === bestCount && label.localeCompare(best) < 0)) {
      best = label;
      bestCount = count;
    }
  }
  return best;
}

function sourceKey(host: ScopeHostInput): string {
  if (host.local) return "local";
  return host.hubOrigin ?? "direct";
}

function shortIds(hosts: readonly ScopeHostInput[]): Map<string, string> {
  const groups = new Map<string, string[]>();
  for (const host of hosts) {
    const key = `${foldSearchText(host.label)}\u0000${sourceKey(host)}`;
    groups.set(key, [...(groups.get(key) ?? []), host.serverId]);
  }
  const result = new Map<string, string>();
  for (const ids of groups.values()) {
    if (ids.length < 2) continue;
    for (const id of ids) result.set(id, id.replace(/^srv_/, "").slice(0, 6));
  }
  return result;
}

export function buildSearchScopeCatalog(input: {
  hosts: readonly ScopeHostInput[];
  projects: readonly ScopeProjectInput[];
  agents: readonly ScopeAgentInput[];
  /** Hubs the reader is signed in to; one with no visible Host still gets a row that says so. */
  signedInHubs?: readonly { origin: string; name: string }[];
}): SearchScopeCatalog {
  const visible = new Set(input.hosts.map((host) => host.serverId));
  // A project on a Host the user cannot see must not leak through search.
  const { drafts, keyByWorkspace, rootsByServerId } = draftProjects(
    input.projects.filter((project) => visible.has(project.serverId)),
  );

  const projectKeyOfAgent = (agent: ScopeAgentInput): string | null => {
    if (agent.workspaceId) {
      const key = keyByWorkspace.get(workspaceKey(agent.serverId, agent.workspaceId));
      if (key) return key;
    }
    if (agent.placementProjectName) {
      const key = projectNameKey(agent.placementProjectName);
      if (drafts.has(key)) return key;
    }
    for (const { root, key } of rootsByServerId.get(agent.serverId) ?? []) {
      if (agent.cwd === root || agent.cwd.startsWith(`${root}/`)) return key;
    }
    return null;
  };

  const sessionsByHost = new Map<string, number>();
  const sessionsByProject = new Map<string, Map<string, number>>();
  for (const agent of input.agents) {
    if (!visible.has(agent.serverId)) continue;
    sessionsByHost.set(agent.serverId, (sessionsByHost.get(agent.serverId) ?? 0) + 1);
    const key = projectKeyOfAgent(agent);
    if (!key) continue;
    const perHost = sessionsByProject.get(key) ?? new Map<string, number>();
    perHost.set(agent.serverId, (perHost.get(agent.serverId) ?? 0) + 1);
    sessionsByProject.set(key, perHost);
  }

  const projectKeysByHost = new Map<string, Set<string>>();
  for (const draft of drafts.values()) {
    for (const id of draft.serverIds) {
      const keys = projectKeysByHost.get(id) ?? new Set<string>();
      keys.add(draft.key);
      projectKeysByHost.set(id, keys);
    }
  }

  const ids = shortIds(input.hosts);
  const hosts: ScopeHost[] = input.hosts
    .map((host) => ({
      ...host,
      shortId: ids.get(host.serverId) ?? null,
      fields: [host.label, host.hubName ?? "", ...host.hostnames]
        .filter(Boolean)
        .map(foldSearchText),
      projectKeys: projectKeysByHost.get(host.serverId) ?? new Set<string>(),
      sessionCount: sessionsByHost.get(host.serverId) ?? 0,
    }))
    .sort((a, b) => a.label.localeCompare(b.label) || a.serverId.localeCompare(b.serverId));
  const hostById = new Map(hosts.map((host) => [host.serverId, host]));

  const serverIdsByHub = new Map<string, string[]>();
  const hubNames = new Map<string, string>();
  for (const host of hosts) {
    if (!host.hubOrigin) continue;
    serverIdsByHub.set(host.hubOrigin, [
      ...(serverIdsByHub.get(host.hubOrigin) ?? []),
      host.serverId,
    ]);
    if (host.hubName) hubNames.set(host.hubOrigin, host.hubName);
  }
  for (const hub of input.signedInHubs ?? []) {
    if (!serverIdsByHub.has(hub.origin)) serverIdsByHub.set(hub.origin, []);
    if (!hubNames.has(hub.origin)) hubNames.set(hub.origin, hub.name);
  }
  const hubs: ScopeHub[] = [...serverIdsByHub].map(([origin, serverIds]) => {
    const name = hubNames.get(origin) ?? origin;
    return {
      origin,
      name,
      serverIds,
      onlineCount: serverIds.filter((id) => hostById.get(id)?.status === "online").length,
      fields: [foldSearchText(name)],
    };
  });

  const projects: ScopeProject[] = [...drafts.values()].map((draft) => {
    const perHost = sessionsByProject.get(draft.key) ?? new Map<string, number>();
    return {
      key: draft.key,
      label: dominantLabel(draft.labels),
      viewKeys: draft.viewKeys,
      serverIds: [...draft.serverIds].sort((a, b) =>
        (hostById.get(a)?.label ?? a).localeCompare(hostById.get(b)?.label ?? b),
      ),
      sessionCount: [...perHost.values()].reduce((sum, count) => sum + count, 0),
      sessionCountByServerId: perHost,
      fields: [...draft.fields],
    };
  });

  const projectKeyByViewKey = new Map<string, string>();
  for (const project of projects) {
    for (const viewKey of project.viewKeys) projectKeyByViewKey.set(viewKey, project.key);
  }

  return {
    hosts,
    hostById,
    hubs,
    hubByOrigin: new Map(hubs.map((hub) => [hub.origin, hub])),
    projects,
    projectByKey: new Map(projects.map((project) => [project.key, project])),
    serverIdsByHub,
    projectKeyByViewKey,
    projectKeyOfWorkspace: (serverId, workspaceId) =>
      keyByWorkspace.get(workspaceKey(serverId, workspaceId)) ?? null,
    projectKeyOfAgent,
  };
}
