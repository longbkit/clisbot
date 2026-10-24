// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collectAllTabs, useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { conversationLayoutKey, openConversationFile } from "./conversation-layout";
import { useConversationTabs } from "./use-conversation-tabs";
import { ConversationResourcePanel } from "./conversation-access";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";

const mocks = vi.hoisted(() => ({ confirm: vi.fn(), build: vi.fn(), open: vi.fn() }));
vi.mock("@/panels/confirm-panel-close", () => ({ confirmPanelClose: mocks.confirm }));
vi.mock("./use-open-conversation-file", () => ({ useOpenConversationFile: () => mocks.open }));
vi.mock("./conversation-access", () => ({
  ConversationResourcePanel: () => null,
  isConversationDocumentTarget: ({ kind }: { kind: string }) => kind === "file",
}));
vi.mock("@/screens/workspace/workspace-pane-content", () => ({
  buildWorkspacePaneContentModel: (input: unknown) => mocks.build(input),
}));
const key = conversationLayoutKey("host", "group", "owner");
const source = { serverId: "host", workspaceId: "writer" };
const paneComponent = () => null;
function descriptor(tab: {
  tabId: string;
  target: WorkspaceTabDescriptor["target"];
}): WorkspaceTabDescriptor {
  return { ...tab, key: tab.tabId, kind: tab.target.kind };
}
function setup() {
  return renderHook(() =>
    useConversationTabs({
      serverId: "host",
      bots: [],
      layoutKey: key,
      singlePanel: true,
      tabs: [],
      selectBot: vi.fn(),
    }),
  ).result;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.confirm.mockResolvedValue(true);
  mocks.build.mockImplementation(() => ({ Component: paneComponent }));
  useWorkspaceLayoutStore.setState({
    layoutByWorkspace: {},
    sheetsByWorkspace: {},
    layoutMode: "compact",
  });
  useWorkspaceLayoutStore.getState().openTab({
    workspaceKey: key,
    target: { kind: "conversation", chatId: "group" },
    intent: "background",
  });
});
afterEach(cleanup);

describe("conversation sheet ownership", () => {
  it("closes a newly opened sheet through its original source and keeps a declined close visible", async () => {
    const result = setup(); // Its caller's pane snapshot has no file or sheet.
    const beforeTabs = collectAllTabs(
      useWorkspaceLayoutStore.getState().layoutByWorkspace[key]!.root,
    );
    const tabId = openConversationFile({
      layoutKey: key,
      source,
      target: { kind: "file", path: "plan.md" },
      compact: true,
    })!;
    expect(useWorkspaceLayoutStore.getState().sheetsByWorkspace[key]?.[0]?.tab.tabId).toBe(tabId);
    mocks.confirm.mockResolvedValueOnce(false);
    await act(() => result.current.closeTab(tabId));
    expect(mocks.confirm).toHaveBeenCalledWith({ ...source, tabId }, expect.any(Object));
    expect(useWorkspaceLayoutStore.getState().sheetsByWorkspace[key]).toHaveLength(1);
    await act(() => result.current.closeTab(tabId));
    expect(useWorkspaceLayoutStore.getState().sheetsByWorkspace[key] ?? []).toHaveLength(0);
    const layout = useWorkspaceLayoutStore.getState().layoutByWorkspace[key]!;
    expect(collectAllTabs(layout.root)).toEqual(beforeTabs);
  });

  it("does not consume another retained conversation's sheet request", async () => {
    const result = setup();
    const otherKey = conversationLayoutKey("host", "dm", "owner");
    const tabId = openConversationFile({
      layoutKey: otherKey,
      source,
      target: { kind: "file", path: "plan.md" },
      compact: true,
    })!;
    await act(() => result.current.closeTab(tabId));
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(useWorkspaceLayoutStore.getState().sheetsByWorkspace[otherKey]).toHaveLength(1);
  });

  it("keeps file content behind the live access gate and allows the ordinary profile renderer", () => {
    const result = setup();
    const file = descriptor({
      tabId: "file",
      target: { kind: "file", path: "plan.md", workspaceContext: source, layoutScope: key },
    });
    expect(result.current.buildContent({ tab: file, paneId: "sheet" }).Component).toBe(
      ConversationResourcePanel,
    );
    expect(mocks.build).toHaveBeenLastCalledWith(
      expect.objectContaining({ normalizedServerId: "host", normalizedWorkspaceId: "writer" }),
    );
    const profile = descriptor({
      tabId: "profile",
      target: { kind: "user_profile", actor: { kind: "user", id: "person" }, layoutScope: key },
    });
    expect(result.current.buildContent({ tab: profile, paneId: "sheet" }).Component).toBe(
      paneComponent,
    );
  });
});
