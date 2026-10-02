import { useCallback } from "react";
import { router } from "expo-router";
import { canCreateWorktreeForProjectKind } from "@/projects/host-projects";
import { useHostFeature } from "@/runtime/host-features";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { useWorkspace } from "@/stores/session-store-hooks";
import { buildNewWorkspaceRoute } from "@/utils/host-routes";

/** Shared by the top navigation and footer New menu; preserves the active Project context. */
export function useOpenNewWorkspace(onBeforeNavigate?: () => void) {
  const selection = useActiveWorkspaceSelection();
  const serverId = selection?.serverId ?? null;
  const workspace = useWorkspace(serverId, selection?.workspaceId ?? null);
  const supportsMultiplicity = useHostFeature(serverId, "workspaceMultiplicity");
  const canUseContext = Boolean(
    workspace && (supportsMultiplicity || canCreateWorktreeForProjectKind(workspace.projectKind)),
  );
  return useCallback(() => {
    onBeforeNavigate?.();
    router.push(
      serverId
        ? buildNewWorkspaceRoute(
            workspace && canUseContext
              ? {
                  serverId,
                  sourceDirectory: workspace.projectRootPath,
                  projectId: workspace.projectId,
                }
              : { serverId },
          )
        : buildNewWorkspaceRoute(),
    );
  }, [workspace, serverId, canUseContext, onBeforeNavigate]);
}
