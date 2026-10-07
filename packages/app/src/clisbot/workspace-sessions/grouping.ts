import type { SidebarWorkspaceGroup } from "@/components/sidebar/sidebar-labels";
import type {
  SidebarProjectEntry,
  SidebarWorkspaceEntry,
} from "@/hooks/use-sidebar-workspaces-list";
import type { SidebarGroupMode } from "@/stores/sidebar-view-store";

/** The grouping modes that list sessions in place of workspace rows. */
const SESSION_GROUP_MODES: ReadonlySet<SidebarGroupMode> = new Set([
  "projectSession",
  "status",
  "session",
]);

export function listsSessions(mode: SidebarGroupMode): boolean {
  return SESSION_GROUP_MODES.has(mode);
}

/**
 * The mode the sidebar draws. With Agent sessions off there are no session lines to list, so each
 * session mode draws as its workspace twin — the same groups without the sessions. Status ›
 * Workspace is also how upstream draws Status.
 */
export function resolveSidebarGroupMode(
  mode: SidebarGroupMode,
  sessionsVisible: boolean,
): SidebarGroupMode {
  if (sessionsVisible) return mode;
  if (mode === "projectSession") return "project";
  if (mode === "status") return "statusWorkspace";
  if (mode === "session") return "workspace";
  return mode;
}

/**
 * The groups for Clisbot's modes, in project order then each project's workspace order, so a
 * row only moves when you reorder it. Workspace and Session put every row in one group with no
 * header; Project › Session gives each project a header and drops a project with no row left.
 */
export function clisbotWorkspaceGroups(input: {
  mode: "projectSession" | "workspace" | "session";
  projects: readonly SidebarProjectEntry[];
  workspaceEntriesByKey: ReadonlyMap<string, SidebarWorkspaceEntry>;
}): SidebarWorkspaceGroup[] {
  const rowsOf = (project: SidebarProjectEntry) =>
    project.workspaces.flatMap((placement) => {
      const entry = input.workspaceEntriesByKey.get(placement.workspaceKey);
      return entry ? [entry] : [];
    });
  if (input.mode !== "projectSession") {
    const rows = input.projects.flatMap(rowsOf);
    return [{ key: "all", label: "", rows, leading: { kind: "none" } }];
  }
  return input.projects.flatMap((project) => {
    const rows = rowsOf(project);
    if (rows.length === 0) return [];
    return [
      {
        key: `project:${project.viewKey}`,
        label: project.projectName,
        rows,
        leading: { kind: "project", projectViewKey: project.viewKey },
      },
    ];
  });
}

/** Every grouping as a menu lists it: each workspace mode beside its session twin. */
export const GROUP_MODE_MENU_ORDER: readonly SidebarGroupMode[] = [
  "project",
  "projectSession",
  "statusWorkspace",
  "status",
  "workspace",
  "session",
];

/** Every grouping, in the order the quick switcher falls back to before any has been used. */
export const GROUP_MODE_ORDER: readonly SidebarGroupMode[] = [
  "project",
  "session",
  "workspace",
  "status",
  "projectSession",
  "statusWorkspace",
];

/**
 * The groupings the quick switcher shows as tabs: the ones picked most, ties and the untouched
 * falling back to `GROUP_MODE_ORDER`. The rest sit behind More. The tabs keep that fixed order
 * rather than their counts', so pressing one never swaps it with its neighbour.
 */
export function quickGroupModes(
  usage: Partial<Record<SidebarGroupMode, number>>,
  count = 2,
): SidebarGroupMode[] {
  const picked = GROUP_MODE_ORDER.map((mode, order) => ({ mode, order, used: usage[mode] ?? 0 }))
    .sort((left, right) => right.used - left.used || left.order - right.order)
    .slice(0, count);
  return GROUP_MODE_ORDER.filter((mode) => picked.some((entry) => entry.mode === mode));
}
