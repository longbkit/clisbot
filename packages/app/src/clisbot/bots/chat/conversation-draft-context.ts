import { createContext, useContext } from "react";
export const ConversationDraftContext = createContext<{
  draftKey: string;
  focusMessages: () => void;
} | null>(null);
export const useConversationDraftContext = () => useContext(ConversationDraftContext);
