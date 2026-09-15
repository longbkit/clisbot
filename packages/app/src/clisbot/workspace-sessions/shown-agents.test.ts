import { describe, expect, it } from "vitest";
import type { WorkspaceLayout } from "@/stores/workspace-layout-actions";
import type { WorkspaceTab } from "@/workspace-tabs/model";
import { parseShownAgents, serializeShownAgents } from "./shown-agents";

function pane(id: string, tabs: WorkspaceTab[], focusedTabId: string | null) {
  return { kind: "pane", pane: { id, tabIds: tabs.map((tab) => tab.tabId), focusedTabId, tabs } };
}

function agentTab(tabId: string, agentId: string): WorkspaceTab {
  return { tabId, target: { kind: "agent", agentId }, createdAt: 1 };
}

// Store layouts carry each pane's tabs next to its ids; the public type only names the ids.
function splitLayout(focusedPaneId: string, ...panes: ReturnType<typeof pane>[]): WorkspaceLayout {
  return {
    focusedPaneId,
    root: { kind: "group", group: { id: "root", direction: "horizontal", children: panes } },
  } as unknown as WorkspaceLayout;
}

function shown(layout: WorkspaceLayout | undefined) {
  const { selectedAgentId, visibleAgentIds } = parseShownAgents(serializeShownAgents(layout));
  return { selectedAgentId, visibleAgentIds: [...visibleAgentIds] };
}

describe("shown agents", () => {
  it("reads the focused pane's agent as selected and other panes as visible", () => {
    const layout = splitLayout(
      "right",
      pane("left", [agentTab("agent_a", "a")], "agent_a"),
      pane("right", [agentTab("agent_b", "b")], "agent_b"),
    );
    expect(shown(layout)).toEqual({ selectedAgentId: "b", visibleAgentIds: ["a"] });
  });

  it("follows the tab target, not the tab id, for a draft that became an agent", () => {
    const layout = splitLayout("main", pane("main", [agentTab("draft_123", "a")], "draft_123"));
    expect(shown(layout).selectedAgentId).toBe("a");
  });

  it("selects nothing when the focused tab is not an agent", () => {
    const terminal: WorkspaceTab = {
      tabId: "terminal_1",
      target: { kind: "terminal", terminalId: "t1" },
      createdAt: 1,
    } as WorkspaceTab;
    const layout = splitLayout(
      "main",
      pane("main", [terminal], "terminal_1"),
      pane("side", [agentTab("agent_a", "a")], "agent_a"),
    );
    expect(shown(layout)).toEqual({ selectedAgentId: null, visibleAgentIds: ["a"] });
    expect(shown(undefined)).toEqual({ selectedAgentId: null, visibleAgentIds: [] });
  });

  it("never lists the selected agent as merely visible", () => {
    const layout = splitLayout(
      "left",
      pane("left", [agentTab("agent_a", "a")], "agent_a"),
      pane("right", [agentTab("agent_a2", "a")], "agent_a2"),
    );
    expect(shown(layout)).toEqual({ selectedAgentId: "a", visibleAgentIds: [] });
  });
});
