import { createContext, useContext } from "react";
import type { WorkspaceTabTarget, WorkspaceTargetContext } from "@/workspace-tabs/model";
export type OpenConversationTarget = (
  source: WorkspaceTargetContext,
  target: WorkspaceTabTarget,
) => void;
export const ConversationFileContext = createContext<OpenConversationTarget | null>(null);
export const useOpenConversationTarget = () => useContext(ConversationFileContext);
