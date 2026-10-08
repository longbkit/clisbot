import { useMemo, type ReactNode } from "react";
import { WorkspaceFocusProvider } from "@/workspace/focus";
import { DiffDocumentWorkspaceCacheProvider } from "@/git/diff-document/workspace-cache";
import { NewTabLauncherProvider, type NewTabLauncher } from "@/workspace-tabs/launcher";
import {
  FloatingPanelPortalHost,
  FloatingPanelPortalHostNameProvider,
} from "@/components/ui/floating-panel-portal";
import { useConversationProjectContext } from "./conversation-project-context";
import { useOpenConversationTarget } from "./conversation-file-context";
const KINDS = ["files", "changes_tree", "working_diff", "commit_diff", "pull_request"] as const;
/** The same provider chain as WorkspaceScreen, with a document-only conversation launcher. */
export function ConversationPanelProviders({
  layoutKey,
  children,
}: {
  layoutKey: string;
  children: ReactNode;
}) {
  const project = useConversationProjectContext();
  const open = useOpenConversationTarget();
  const launcher = useMemo<NewTabLauncher>(
    () => ({
      showChanges: project?.isGit ?? false,
      showPullRequest: project?.isGit ?? false,
      showBrowser: false,
      terminalDisabled: true,
      workspaceDirectory: project?.cwd,
      supportedKinds: KINDS,
      launch: (selection) => {
        if (selection.kind === "target" && project?.workspaceId)
          open?.(
            { serverId: project.serverId, workspaceId: project.workspaceId },
            selection.target,
          );
      },
    }),
    [open, project],
  );
  return (
    <WorkspaceFocusProvider workspaceKey={layoutKey}>
      <DiffDocumentWorkspaceCacheProvider>
        <NewTabLauncherProvider value={launcher}>
          <FloatingPanelPortalHostNameProvider hostName={layoutKey}>
            {children}
          </FloatingPanelPortalHostNameProvider>
          <FloatingPanelPortalHost name={layoutKey} />
        </NewTabLauncherProvider>
      </DiffDocumentWorkspaceCacheProvider>
    </WorkspaceFocusProvider>
  );
}
