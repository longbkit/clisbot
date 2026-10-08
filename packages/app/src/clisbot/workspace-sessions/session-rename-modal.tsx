import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { AdaptiveRenameModal } from "@/components/rename-modal";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";

/**
 * Renames one session from its sidebar line, the way a session tab is renamed
 * (`screens/workspace/use-workspace-tab-rename.tsx`): the agent's title, through `update_agent`.
 */
export function SessionRenameModal({
  serverId,
  agentId,
  visible,
  onClose,
}: {
  serverId: string;
  agentId: string;
  visible: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const title = useSessionStore(
    (state) => state.sessions[serverId]?.agents?.get(agentId)?.title ?? "",
  );
  const submit = useCallback(
    async (nextTitle: string) => {
      const client = getHostRuntimeStore().getClient(serverId);
      if (!client) throw new Error(t("workspace.terminal.hostDisconnected"));
      await client.updateAgent(agentId, { name: nextTitle.trim() });
      void queryClient.invalidateQueries({ queryKey: ["sidebarAgentsList", serverId] });
      void queryClient.invalidateQueries({ queryKey: ["allAgents", serverId] });
    },
    [agentId, queryClient, serverId, t],
  );
  return (
    <AdaptiveRenameModal
      visible={visible}
      title={t("sidebar.workspace.actions.renameSession")}
      initialValue={title}
      submitLabel={t("workspace.tabs.menu.rename")}
      maxLength={200}
      onClose={onClose}
      onSubmit={submit}
      testID={`sidebar-session-rename-modal-${agentId}`}
    />
  );
}
