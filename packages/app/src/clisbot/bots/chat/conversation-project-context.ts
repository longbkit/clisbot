import { createContext, useContext } from "react";
export interface ConversationProjectContextValue {
  serverId: string;
  botId?: string;
  agentId?: string;
  canConfigure?: boolean;
  botName?: string;
  workspaceId?: string;
  cwd: string | null;
  isGit: boolean;
  group: boolean;
  chooseBot: () => void;
}
export const ConversationProjectContext = createContext<ConversationProjectContextValue | null>(
  null,
);
export const useConversationProjectContext = () => useContext(ConversationProjectContext);
