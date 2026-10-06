import type { SidebarWorkspaceGroup } from "@/components/sidebar/sidebar-labels";
import type {
  SidebarWorkspaceEntry,
  SidebarWorkspacePlacement,
} from "@/hooks/use-sidebar-workspaces-list";
import type {
  SidebarShortcutModel,
  SidebarShortcutWorkspaceTarget,
} from "@/utils/sidebar-shortcuts";
import {
  STATUS_BUCKET_LABELS,
  STATUS_BUCKET_ORDER,
  type StatusBucket,
} from "@/hooks/sidebar-status-view-model";
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

/** Status mode as upstream draws it: each workspace row stays in its workspace's group. */
export function workspaceStatusDisplayGroups(
  groups: readonly SidebarWorkspaceGroup[],
): StatusDisplayGroup[] {
  return groups.map((group) => ({
    ...group,
    items: group.rows.map((workspace) => workspaceItem(workspace)),
  }));
}

/**
 * Status mode with Agent sessions on: the sessions themselves are grouped by status, so a
 * workspace whose sessions differ in status shows each one under the header it belongs to.
 *
 * Inside a group the most recently messaged session comes first. That time only moves when
 * someone sends a message, so a line does not jump while its turn streams.
 */
export function sessionStatusDisplayGroups(input: {
  groups: readonly SidebarWorkspaceGroup[];
  sources: ReadonlyMap<string, WorkspaceSessionSource>;
  activeOnly: boolean;
}): StatusDisplayGroup[] {
  const buckets = new Map<StatusBucket, RankedItem[]>();
  const add = (bucket: StatusBucket, item: RankedItem) => {
    const items = buckets.get(bucket) ?? [];
    items.push(item);
    buckets.set(bucket, items);
  };
  let order = 0;
  for (const workspace of input.groups.flatMap((group) => group.rows)) {
    const source = input.sources.get(workspace.serverId);
    if (!source || listWorkspaceRootAgents(source.agents, workspace.workspaceId).length === 0) {
      add(workspace.statusBucket, {
        item: workspaceItem(workspace),
        time: workspace.statusEnteredAt?.getTime() ?? null,
        order: order++,
      });
      continue;
    }
    const sessions = selectWorkspaceSessions({
      source,
      workspaceId: workspace.workspaceId,
      activeOnly: input.activeOnly,
    });
    for (const session of sessions) {
      add(session.statusBucket, {
        item: {
          kind: "session",
          key: `${workspace.workspaceKey}:${session.agent.id}`,
          workspace,
          session,
        },
        time: (session.agent.lastUserMessageAt ?? session.agent.createdAt).getTime(),
        order: order++,
      });
    }
  }
  return STATUS_BUCKET_ORDER.flatMap((bucket) => {
    const ranked = buckets.get(bucket);
    if (!ranked) return [];
    const items = ranked.sort(compareRanked).map((entry) => entry.item);
    // The workspaces that have a line here, so `rows` still answers "which workspaces".
    const rows = [...new Set(items.map((item) => item.workspace))];
    const leading = { kind: "status", bucket } as const;
    return [{ key: bucket, label: STATUS_BUCKET_LABELS[bucket], rows, leading, items }];
  });
}

interface RankedItem {
  item: StatusGroupItem;
  time: number | null;
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
 * Cmd+1…9 for Status grouping with sessions: the numbers follow the lines as drawn — open Pinned
 * rows first, then each open status header's lines — and a session's number opens that session.
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
