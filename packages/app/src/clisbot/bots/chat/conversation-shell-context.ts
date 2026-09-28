import { createContext, useContext } from "react";
/** Shared chrome keeps its normal launcher outside conversation layouts. */
export const ConversationShellContext = createContext(false);
export const useIsConversationShell = () => useContext(ConversationShellContext);
