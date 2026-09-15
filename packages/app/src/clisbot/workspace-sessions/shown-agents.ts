import {
  collectAllPanes,
  collectAllTabs,
  type WorkspaceLayout,
} from "@/stores/workspace-layout-actions";

export interface ShownAgents {
  /** The agent in the focused pane — the session you are in. */
  selectedAgentId: string | null;
  /** Agents showing in the other visible panes of a split. Never contains `selectedAgentId`. */
  visibleAgentIds: ReadonlySet<string>;
}

export const NO_SHOWN_AGENTS: ShownAgents = { selectedAgentId: null, visibleAgentIds: new Set() };

/**
 * Which agents a workspace layout is showing, read from each pane's focused tab **target**.
 *
 * Not from tab ids: a draft tab keeps its draft id after it becomes an agent, and a restored
 * layout keeps whatever id it stored, so `agent_<id>` is not a reliable key.
 *
 * Returned as one string (`selected` first, then the others, newline-joined) so a store
 * subscription compares by value; `parseShownAgents` turns it back.
 */
export function serializeShownAgents(layout: WorkspaceLayout | undefined): string {
  if (!layout) return "";
  const agentIdByTabId = new Map(
    collectAllTabs(layout.root).flatMap((tab) =>
      tab.target.kind === "agent" ? [[tab.tabId, tab.target.agentId] as const] : [],
    ),
  );
  const agentIdOf = (tabId: string | null) => (tabId ? (agentIdByTabId.get(tabId) ?? "") : "");
  const panes = collectAllPanes(layout.root);
  const focused = panes.find((pane) => pane.id === layout.focusedPaneId);
  const others = panes
    .filter((pane) => pane !== focused)
    .map((pane) => agentIdOf(pane.focusedTabId))
    .filter((agentId) => agentId !== "");
  return [agentIdOf(focused?.focusedTabId ?? null), ...others].join("\n");
}

export function parseShownAgents(serialized: string): ShownAgents {
  if (!serialized) return NO_SHOWN_AGENTS;
  const [selected = "", ...others] = serialized.split("\n");
  const visibleAgentIds = new Set(others.filter((agentId) => agentId !== selected));
  return { selectedAgentId: selected || null, visibleAgentIds };
}
