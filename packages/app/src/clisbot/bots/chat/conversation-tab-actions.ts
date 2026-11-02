import * as Clipboard from "expo-clipboard";
import type { useConversationLayout } from "./use-conversation-layout";
import type { useConversationTabs } from "./use-conversation-tabs";

const noop = () => {};
const copy = async (value: string) => {
  await Clipboard.setStringAsync(value);
};

/** What a conversation tab's menu copies; it has no agent to reload or tab to rename. */
export const conversationClipboardActions = {
  onCopyResumeCommand: noop,
  onCopyAgentId: copy,
  onCopyTerminalId: copy,
  onCopyFilePath: copy,
  onReloadAgent: noop,
  onRenameTab: noop,
};

type MainTabs = ReturnType<typeof useConversationLayout>["mainTabs"];
type BulkClose = ReturnType<typeof useConversationTabs>["bulkClose"];

export function buildConversationCloseActions(mainTabs: MainTabs, bulkClose: BulkClose) {
  const indexOf = (id: string) => mainTabs.findIndex((tab) => tab.tabId === id);
  return {
    onCloseTabsAbove: (id: string) =>
      bulkClose(mainTabs.slice(0, indexOf(id)).map((tab) => tab.tabId)),
    onCloseTabsBelow: (id: string) =>
      bulkClose(mainTabs.slice(indexOf(id) + 1).map((tab) => tab.tabId)),
    onCloseOtherTabs: (id: string) =>
      bulkClose(mainTabs.filter((tab) => tab.tabId !== id).map((tab) => tab.tabId)),
  };
}
