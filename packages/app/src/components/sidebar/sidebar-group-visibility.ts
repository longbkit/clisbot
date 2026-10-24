import type {
  SidebarWorkspacePlacement,
  SidebarStateBucket,
} from "@/hooks/sidebar-workspaces-view-model";

export type SidebarGroupVisibilityPolicy<T> =
  | { kind: "pinned" }
  | { kind: "workspaces"; getStatusBucket: (item: T) => SidebarStateBucket | null };

export function selectSidebarGroupVisibility<T>(
  items: readonly T[],
  expanded: boolean,
  policy: SidebarGroupVisibilityPolicy<T>,
) {
  const limit = policy.kind === "pinned" ? 20 : 7;
  const baseline = items.filter((item, index) => {
    if (index < limit) return true;
    if (policy.kind !== "workspaces") return false;
    const status = policy.getStatusBucket(item);
    return status !== null && status !== "done";
  });
  return {
    visibleItems: expanded ? items.slice() : baseline,
    canToggle: baseline.length < items.length,
  };
}

/** Placements may precede hydrated row metadata; unknown status only uses the baseline limit. */
export function createSidebarWorkspaceVisibilityPolicy(
  entries: ReadonlyMap<string, { statusBucket: SidebarStateBucket }>,
): SidebarGroupVisibilityPolicy<SidebarWorkspacePlacement> {
  return {
    kind: "workspaces",
    getStatusBucket: (workspace) => entries.get(workspace.workspaceKey)?.statusBucket ?? null,
  };
}
