import { useCallback, useMemo } from "react";
import { useOpenConversationTarget } from "@/clisbot/bots/chat/conversation-file-context";
import { FOCUSED_PANE_PLACEMENT, useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import type { WorkspaceTabPlacement } from "@/stores/workspace-layout-actions";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { openWorkspacePullRequest } from "@/workspace-tabs/open-supporting-view";
import type { PullRequestOpenLocation } from "@/hooks/use-settings";
export function useDiffTabNavigation({
  serverId,
  workspaceId,
  cwd,
  isMobile,
  pullRequestOpenLocation,
}: {
  serverId: string;
  workspaceId?: string | null;
  cwd: string;
  isMobile: boolean;
  pullRequestOpenLocation: PullRequestOpenLocation;
}) {
  const openConversationTarget = useOpenConversationTarget();
  const openInConversation = useCallback(
    (target: WorkspaceTabTarget) => {
      if (!openConversationTarget) return false;
      if (workspaceId) openConversationTarget({ serverId, workspaceId }, target);
      return true;
    },
    [openConversationTarget, serverId, workspaceId],
  );
  const openTab = useWorkspaceLayoutStore((state) => state.openTab);
  const openWorkspaceTab = useCallback(
    (workspaceKey: string, target: WorkspaceTabTarget, placement?: WorkspaceTabPlacement) =>
      openTab({ workspaceKey, target, intent: "reveal", placement }),
    [openTab],
  );
  const persistenceKey = useMemo(
    () => buildWorkspaceTabPersistenceKey({ serverId, workspaceId: workspaceId ?? cwd }),
    [cwd, serverId, workspaceId],
  );
  const openDiff = useCallback(() => {
    if (openInConversation({ kind: "working_diff" })) return;
    if (!persistenceKey || isMobile) {
      return;
    }
    openWorkspaceTab(persistenceKey, { kind: "working_diff" }, FOCUSED_PANE_PLACEMENT);
  }, [isMobile, openWorkspaceTab, persistenceKey, openInConversation]);
  const openCommit = useCallback(
    (sha: string) => {
      if (openInConversation({ kind: "commit_diff", sha })) return;
      if (persistenceKey) {
        openWorkspaceTab(persistenceKey, { kind: "commit_diff", sha }, FOCUSED_PANE_PLACEMENT);
      }
    },
    [openWorkspaceTab, persistenceKey, openInConversation],
  );
  const openPullRequest = useCallback(() => {
    if (openInConversation({ kind: "pull_request" })) return;
    if (!persistenceKey) return;
    openWorkspacePullRequest({
      isCompact: isMobile,
      workspaceKey: persistenceKey,
      checkout: { serverId, cwd, isGit: true },
      destination: pullRequestOpenLocation,
    });
  }, [cwd, isMobile, persistenceKey, pullRequestOpenLocation, serverId, openInConversation]);
  return {
    openDiff,
    openCommit,
    openPullRequest,
  };
}
