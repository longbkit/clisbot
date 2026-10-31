import type { SidebarWorkspaceGroup } from "@/components/sidebar/sidebar-labels";
import type {
  SidebarWorkspaceEntry,
  SidebarWorkspacePlacement,
} from "@/hooks/use-sidebar-workspaces-list";
import type {
  SidebarShortcutModel,
  SidebarShortcutWorkspaceTarget,
} from "@/utils/sidebar-shortcuts";
import type { TFunction } from "i18next";
import type { Agent } from "@/stores/session-store";
import {
  getStatusBucketLabel,
  STATUS_BUCKET_ORDER,
  type StatusBucket,
} from "@/hooks/sidebar-status-view-model";
import type { WorkspaceSessionFilter } from "./session-filter";
import {
  listWorkspaceRootAgents,
  selectWorkspaceSessions,
  type WorkspaceSessionItem,
  type WorkspaceSessionSource,
} from "./select-sessions";

/**
 * One line under a status header. A workspace with sessions is replaced by its sessions, each
 * filed under its own status; a workspace without any keeps its row, so a terminal-only
 * workspace stays reachable.
 */
export type StatusGroupItem =
  | { kind: "workspace"; key: string; workspace: SidebarWorkspaceEntry }
  | StatusSessionGroupItem;

export interface StatusSessionGroupItem {
  kind: "session";
  /** `workspaceKey:agentId` — also the line's shortcut index key. */
  key: string;
  workspace: SidebarWorkspaceEntry;
  session: WorkspaceSessionItem;
}

export interface StatusDisplayGroup extends SidebarWorkspaceGroup {
  items: StatusGroupItem[];
}

/** The groups as given, one row per workspace — Status as upstream draws it, and Workspace. */
export function workspaceStatusDisplayGroups(
  groups: readonly SidebarWorkspaceGroup[],
): StatusDisplayGroup[] {
  return groups.map((group) => ({
    ...group,
    items: group.rows.map((workspace) => workspaceItem(workspace)),
  }));
}

/**
 * The session modes with Agent sessions on: each workspace that has sessions is replaced by its
 * sessions. Status files every session under its own status header, so a workspace whose
 * sessions differ in status shows each one where it belongs; Project › Session and Session keep
 * the groups they were given and list the sessions inside them.
 *
 * Inside a group the most recently messaged session comes first. That time only moves when
 * someone sends a message, so a line does not jump while its turn streams.
 */
export function sessionDisplayGroups(input: SessionDisplayGroupsInput): StatusDisplayGroup[] {
  return groupLines(input, (workspace) => workspaceLines({ ...input, workspace }));
}

export interface SessionDisplayGroupsInput {
  groups: readonly SidebarWorkspaceGroup[];
  sources: ReadonlyMap<string, WorkspaceSessionSource>;
  activeOnly: boolean;
  /** Sessions a pane shows, kept by Active sessions only. */
  keepAgentIds?: ReadonlySet<string>;
  /** The list owner's session rule (Navigation V2's Workspace scope); absent lists all. */
  sessionFilter?: WorkspaceSessionFilter | null;
  byStatus: boolean;
  t: TFunction;
}

interface CachedLines {
  workspace: SidebarWorkspaceEntry;
  roots: readonly Agent[] | null;
  source: Omit<WorkspaceSessionSource, "agents"> | null;
  lines: WorkspaceLine[];
}

/**
 * `sessionDisplayGroups` for a hook that runs on every agent change of every Host it lists. A
 * workspace's lines are rebuilt only when its row, its root-agent list or its Host's submissions
 * changed; when none was, and the groups and query are the same, the previous result comes back.
 */
export function createSessionDisplayGroupsMemo(): (
  input: SessionDisplayGroupsInput,
) => StatusDisplayGroup[] {
  let last: SessionDisplayGroupsInput | null = null;
  let cache = new Map<string, CachedLines>();
  let result: StatusDisplayGroup[] = [];
  return (input) => {
    const sameQuery = last !== null && isSameQuery(last, input);
    const previous = sameQuery ? cache : new Map<string, CachedLines>();
    cache = new Map();
    let reused = sameQuery && last?.groups === input.groups;
    for (const workspace of input.groups.flatMap((group) => group.rows)) {
      const entry = cachedLinesOf(input, workspace, previous.get(workspace.workspaceKey));
      if (entry !== previous.get(workspace.workspaceKey)) reused = false;
      cache.set(workspace.workspaceKey, entry);
    }
    last = input;
    if (reused) return result;
    result = groupLines(input, (workspace) => cache.get(workspace.workspaceKey)?.lines ?? []);
    return result;
  };
}

function isSameQuery(left: SessionDisplayGroupsInput, right: SessionDisplayGroupsInput): boolean {
  return (
    left.activeOnly === right.activeOnly &&
    left.keepAgentIds === right.keepAgentIds &&
    left.sessionFilter === right.sessionFilter &&
    left.byStatus === right.byStatus &&
    left.t === right.t
  );
}

function cachedLinesOf(
  input: SessionDisplayGroupsInput,
  workspace: SidebarWorkspaceEntry,
  previous: CachedLines | undefined,
): CachedLines {
  const found = input.sources.get(workspace.serverId);
  const roots = found ? listWorkspaceRootAgents(found.agents, workspace.workspaceId) : null;
  const source = found
    ? { messageSubmissions: found.messageSubmissions, cached: found.cached }
    : null;
  if (
    previous?.workspace === workspace &&
    sameAgents(previous.roots, roots) &&
    previous.source?.messageSubmissions === source?.messageSubmissions &&
    previous.source?.cached === source?.cached
  ) {
    return previous;
  }
  return { workspace, roots, source, lines: workspaceLines({ ...input, workspace }) };
}

// The store keeps an unchanged workspace's list by reference; a list rebuilt elsewhere still
// matches while it holds the same agents.
function sameAgents(left: readonly Agent[] | null, right: readonly Agent[] | null): boolean {
  if (left === right) return true;
  if (!left || !right || left.length !== right.length) return false;
  return left.every((agent, index) => agent === right[index]);
}

function groupLines(
  input: SessionDisplayGroupsInput,
  linesOf: (workspace: SidebarWorkspaceEntry) => WorkspaceLine[],
): StatusDisplayGroup[] {
  let order = 0;
  const rank = (group: SidebarWorkspaceGroup): RankedItem[] =>
    group.rows.flatMap((workspace) =>
      linesOf(workspace).map(
        (line): RankedItem => ({
          item: line.item,
          bucket: line.bucket,
          time: line.time,
          order: order++,
        }),
      ),
    );
  if (!input.byStatus) {
    return input.groups.flatMap((group) => {
      const ranked = rank(group);
      if (ranked.length === 0) return [];
      return [displayGroup({ ...group }, ranked)];
    });
  }
  const buckets = new Map<StatusBucket, RankedItem[]>();
  for (const entry of input.groups.flatMap(rank)) {
    const items = buckets.get(entry.bucket) ?? [];
    items.push(entry);
    buckets.set(entry.bucket, items);
  }
  return STATUS_BUCKET_ORDER.flatMap((bucket) => {
    const ranked = buckets.get(bucket);
    if (!ranked) return [];
    const leading = { kind: "status", bucket } as const;
    return [
      displayGroup({ key: bucket, label: getStatusBucketLabel(bucket, input.t), leading }, ranked),
    ];
  });
}

/** One workspace's lines: its sessions, or its own row while it has none to list. */
function workspaceLines(input: {
  workspace: SidebarWorkspaceEntry;
  sources: ReadonlyMap<string, WorkspaceSessionSource>;
  activeOnly: boolean;
  keepAgentIds?: ReadonlySet<string>;
  sessionFilter?: WorkspaceSessionFilter | null;
}): WorkspaceLine[] {
  const { workspace } = input;
  const source = input.sources.get(workspace.serverId);
  if (!source || listWorkspaceRootAgents(source.agents, workspace.workspaceId).length === 0) {
    const time = workspace.statusEnteredAt?.getTime() ?? null;
    const item = workspaceItem(workspace);
    return [{ item, bucket: workspace.statusBucket, time }];
  }
  const sessions = selectWorkspaceSessions({
    source,
    workspaceId: workspace.workspaceId,
    activeOnly: input.activeOnly,
    keepAgentIds: input.keepAgentIds,
    include: input.sessionFilter
      ? (session) => input.sessionFilter!(session, workspace)
      : undefined,
  });
  return sessions.map((session) => ({
    item: {
      kind: "session",
      key: `${workspace.workspaceKey}:${session.agent.id}`,
      workspace,
      session,
    },
    bucket: session.statusBucket,
    time: (session.agent.lastUserMessageAt ?? session.agent.createdAt).getTime(),
  }));
}

function displayGroup(
  group: Omit<SidebarWorkspaceGroup, "rows">,
  ranked: RankedItem[],
): StatusDisplayGroup {
  const items = ranked.sort(compareRanked).map((entry) => entry.item);
  // The workspaces that have a line here, so `rows` still answers "which workspaces".
  const rows = [...new Set(items.map((item) => item.workspace))];
  return { ...group, rows, items };
}

interface WorkspaceLine {
  item: StatusGroupItem;
  bucket: StatusBucket;
  time: number | null;
}

interface RankedItem extends WorkspaceLine {
  /** Position in the incoming workspace order — the tie-break, so equal times never swap. */
  order: number;
}

function compareRanked(left: RankedItem, right: RankedItem): number {
  if (left.time !== right.time) {
    if (left.time === null) return 1;
    if (right.time === null) return -1;
    return right.time - left.time;
  }
  return left.order - right.order;
}

function workspaceItem(workspace: SidebarWorkspaceEntry): StatusGroupItem {
  return { kind: "workspace", key: workspace.workspaceKey, workspace };
}

const SHORTCUT_LIMIT = 9;

/**
 * Cmd+1…9 for the session modes: the numbers follow the lines as drawn — open Pinned rows first,
 * then each open group's lines — and a session's number opens that session.
 * Indexed by item key (`workspaceKey` for a row, `workspaceKey:agentId` for a session line).
 */
export function buildStatusSessionShortcutModel(input: {
  pinnedWorkspaces: readonly SidebarWorkspacePlacement[];
  pinnedCollapsed: boolean;
  groups: readonly StatusDisplayGroup[];
  collapsedGroupKeys: ReadonlySet<string>;
}): SidebarShortcutModel {
  const lines: { key: string; target: SidebarShortcutWorkspaceTarget }[] = [];
  if (!input.pinnedCollapsed) {
    for (const workspace of input.pinnedWorkspaces) {
      lines.push({ key: workspace.workspaceKey, target: workspaceTarget(workspace) });
    }
  }
  for (const group of input.groups) {
    if (input.collapsedGroupKeys.has(group.key)) continue;
    for (const item of group.items) {
      const target = workspaceTarget(item.workspace);
      lines.push({
        key: item.key,
        target: item.kind === "session" ? { ...target, agentId: item.session.agent.id } : target,
      });
    }
  }
  const shortcutLines = lines.slice(0, SHORTCUT_LIMIT);
  return {
    shortcutTargets: shortcutLines.map((line) => line.target),
    shortcutIndexByWorkspaceKey: new Map(shortcutLines.map((line, index) => [line.key, index + 1])),
  };
}

function workspaceTarget(workspace: SidebarWorkspacePlacement): SidebarShortcutWorkspaceTarget {
  return { serverId: workspace.serverId, workspaceId: workspace.workspaceId };
}
