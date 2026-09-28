import { createContext, createElement, useCallback, useContext, type ReactNode } from "react";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";
export const ConversationSourceLabelsContext = createContext<ReadonlyMap<string, string>>(
  new Map(),
);
export const ConversationGroupContext = createContext<boolean | null>(null);

export function conversationTabContextLabel(
  target: WorkspaceTabTarget,
  labels: ReadonlyMap<string, string>,
  group: boolean,
) {
  if (target.kind === "conversation") return group ? "Group conversation" : undefined;
  const source = target.workspaceContext;
  const bot =
    group && source ? labels.get(JSON.stringify([source.serverId, source.workspaceId])) : undefined;
  const path = "path" in target && typeof target.path === "string" ? target.path : "";
  const directory = path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : undefined;
  return [bot, directory].filter(Boolean).join(" · ") || undefined;
}

export function useConversationSourceLabel(target: WorkspaceTabTarget) {
  const labels = useContext(ConversationSourceLabelsContext);
  const group = useContext(ConversationGroupContext);
  return group === null ? undefined : conversationTabContextLabel(target, labels, group);
}

/** Sheets render in a separate root; capture source labels before crossing that boundary. */
export function useConversationSourceLabelsBridge() {
  const labels = useContext(ConversationSourceLabelsContext);
  const group = useContext(ConversationGroupContext);
  return useCallback(
    (children: ReactNode) =>
      createElement(
        ConversationGroupContext.Provider,
        { value: group },
        createElement(ConversationSourceLabelsContext.Provider, { value: labels }, children),
      ),
    [labels, group],
  );
}
