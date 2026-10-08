import { createContext, useContext } from "react";
import { View, Text } from "react-native";
import { useTranslation } from "react-i18next";
import { usePaneContext } from "@/panels/pane-context";
import { getPanelRegistration } from "@/panels/panel-registry";
import { useWorkspace } from "@/stores/session-store-hooks";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";
export const ConversationAccessContext = createContext<ReadonlySet<string>>(new Set());
export const conversationSourceKey = (serverId: string, workspaceId: string) =>
  JSON.stringify([serverId, workspaceId]);
export function isConversationDocumentTarget(target: WorkspaceTabTarget) {
  return ["file", "files", "changes_tree", "working_diff", "commit_diff", "pull_request"].includes(
    target.kind,
  );
}
/** Recheck live project access before mounting panels which can read or mutate files. */
export function ConversationResourcePanel() {
  const { t } = useTranslation();
  const { serverId, workspaceId, target } = usePaneContext();
  const allowed = useContext(ConversationAccessContext);
  const workspace = useWorkspace(serverId, workspaceId);
  const permitted =
    isConversationDocumentTarget(target) &&
    workspace &&
    allowed.has(conversationSourceKey(serverId, workspaceId));
  if (!permitted)
    return (
      <View>
        <Text>{t("bots.chat.access.required")}</Text>
      </View>
    );
  const Component = getPanelRegistration(target.kind)?.component;
  return Component ? <Component /> : null;
}
