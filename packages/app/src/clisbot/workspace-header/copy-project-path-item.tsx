import * as Clipboard from "expo-clipboard";
import { useCallback, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Copy } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/contexts/toast-context";
import { useWorkspaceFields } from "@/stores/session-store-hooks";
import type { Theme } from "@/styles/theme";
import { shortenPath } from "@/utils/shorten-path";

const ThemedCopy = withUnistyles(Copy);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const COPY_ICON = <ThemedCopy size={16} uniProps={mutedColorMapping} />;

/**
 * The project's own group in the workspace header menu: its name as the heading, then Copy
 * project path with the root under it. A worktree lives away from its project's root, so the root
 * is the path you need for anything project-wide. The name is a heading rather than a line of the
 * item's description, which keeps the path on one line, cut in the middle, as the workspace path.
 * It reads the workspace itself, so the upstream header only hands it which workspace this is.
 */
export function CopyProjectPathItem({
  serverId,
  workspaceId,
}: {
  serverId: string;
  workspaceId: string;
}): ReactElement | null {
  const { t } = useTranslation();
  const toast = useToast();
  const project = useWorkspaceFields(serverId, workspaceId, (workspace) => ({
    name: workspace.projectDisplayName,
    rootPath: workspace.projectRootPath,
  }));
  const rootPath = project?.rootPath ?? null;
  const handleSelect = useCallback(async () => {
    if (!rootPath) return;
    try {
      await Clipboard.setStringAsync(rootPath);
      toast.copied(t("workspace.header.toasts.projectPathCopiedLabel"));
    } catch {
      toast.error(t("workspace.tabs.toasts.copyFailed"));
    }
  }, [rootPath, toast, t]);
  if (!project?.rootPath) return null;
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuLabel testID="workspace-header-project-name">{project.name}</DropdownMenuLabel>
      <DropdownMenuItem
        testID="workspace-header-copy-project-path"
        leading={COPY_ICON}
        onSelect={handleSelect}
        description={shortenPath(project.rootPath) || undefined}
        descriptionLines={1}
        descriptionEllipsize="middle"
      >
        {t("workspace.header.actions.copyProjectPath")}
      </DropdownMenuItem>
    </>
  );
}
