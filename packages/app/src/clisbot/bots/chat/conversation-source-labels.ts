import { createContext, createElement, useCallback, useContext, type ReactNode } from "react";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";
export const ConversationSourceLabelsContext = createContext<ReadonlyMap<string, string>>(
  new Map(),
);
export function useConversationSourceLabel(target: WorkspaceTabTarget) {
  const labels = useContext(ConversationSourceLabelsContext);
  return target.workspaceContext
    ? labels.get(
        JSON.stringify([target.workspaceContext.serverId, target.workspaceContext.workspaceId]),
      )
    : undefined;
}

/** Sheets render in a separate root; capture source labels before crossing that boundary. */
export function useConversationSourceLabelsBridge() {
  const labels = useContext(ConversationSourceLabelsContext);
  return useCallback(
    (children: ReactNode) =>
      createElement(ConversationSourceLabelsContext.Provider, { value: labels }, children),
    [labels],
  );
}
