import { i18n } from "@/i18n/i18next";
import { conversationTabContextLabel } from "./conversation-source-labels";
import type { useConversationLayout } from "./use-conversation-layout";

export function buildConversationTabOptions(
  tabs: ReturnType<typeof useConversationLayout>["mainTabs"],
  labels: ReadonlyMap<string, string>,
  group: boolean,
) {
  return tabs.map((tab) => {
    const target = tab.target;
    const context = conversationTabContextLabel(target, labels, group);
    const path = "path" in target && typeof target.path === "string" ? target.path : "";
    const label =
      target.kind === "conversation"
        ? i18n.t("bots.chat.common.messages")
        : path.split("/").pop() || i18n.t("bots.chat.common.changes");
    return {
      id: tab.tabId,
      kind: target.kind,
      label,
      description: context,
      searchText: `${label} ${context ?? ""} ${path}`,
    };
  });
}

export function filterConversationTabs(
  tabs: ReturnType<typeof buildConversationTabOptions>,
  query: string,
) {
  const search = query.trim().toLocaleLowerCase();
  return tabs.filter((tab) => tab.searchText.toLocaleLowerCase().includes(search));
}
