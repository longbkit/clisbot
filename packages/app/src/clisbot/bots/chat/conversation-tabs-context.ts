import { createContext, useContext } from "react";
import type { useConversationLayout } from "./use-conversation-layout";

export const ConversationTabsContext = createContext<{
  tabs: ReturnType<typeof useConversationLayout>["mainTabs"];
  activeId: string | undefined;
  /** The active tab's key, which `selectTab`'s tab rows compare against on a phone. */
  activeKey: string;
  selectTab: (id: string) => void;
  closeTab: (id: string) => Promise<void> | void;
  bulkClose: (ids: string[]) => Promise<void>;
} | null>(null);

export const useConversationTabsContext = () => useContext(ConversationTabsContext);
