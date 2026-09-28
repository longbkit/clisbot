import { createContext, useContext } from "react";
import type { useConversationLayout } from "./use-conversation-layout";

export const ConversationTabsContext = createContext<{
  tabs: ReturnType<typeof useConversationLayout>["mainTabs"];
  activeId: string | undefined;
  selectTab: (id: string) => void;
} | null>(null);

export const useConversationTabsContext = () => useContext(ConversationTabsContext);
