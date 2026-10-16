// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ back: vi.fn(), remove: vi.fn() }));
vi.mock("react-native", () => ({
  BackHandler: { addEventListener: native.back },
}));
vi.mock("@/constants/platform", () => ({ isWeb: false }));
vi.mock("@/constants/layout", () => ({ useIsCompactFormFactor: () => true }));
vi.mock("@/workspace-tabs/open-beside", () => ({
  openWorkspaceTargetAtLocation: vi.fn(),
}));
vi.mock("@/plugins/workspace-panels/locations", () => ({
  panelTargetSupportsHostForWorkspaceKey: () => true,
}));
import { usePanelStore } from "@/stores/panel-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { useConversationExplorerOwner } from "./explorer-owner";
import { useConversationExplorer } from "./use-conversation-explorer";
const source = { serverId: "host", workspaceId: "workspace" };
const ready = {
  layoutKey: "conversation-a",
  focused: true,
  singlePanel: true,
  source,
  cwd: "/test-project",
  isGit: false,
};
type Input = Parameters<typeof useConversationExplorer>[0];
const initialPanels = usePanelStore.getInitialState();
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
beforeEach(async () => {
  await usePanelStore.persist.rehydrate();
  usePanelStore.setState(initialPanels, true);
  useConversationExplorerOwner.getState().setOwner(null);
  native.back.mockReset().mockReturnValue({ remove: native.remove });
});
function mount(input: Input = ready) {
  return renderHook((props: Input) => useConversationExplorer(props), {
    initialProps: input,
  });
}
it("cold missing project preserves the outgoing Chat panel and its exact revision", () => {
  usePanelStore.getState().showMobileAgentList();
  const selection = usePanelStore.getState().mobilePanel;
  mount({ ...ready, source: null, cwd: null });
  expect(usePanelStore.getState().mobilePanel).toBe(selection);
});
it("focus-loss cleanup cannot undo Back to Chat", () => {
  const view = mount();
  act(() => {
    usePanelStore.getState().showMobileAgentList();
  });
  const selection = usePanelStore.getState().mobilePanel;
  view.rerender({ ...ready, focused: false });
  expect(usePanelStore.getState().mobilePanel).toBe(selection);
  expect(useConversationExplorerOwner.getState().owner).toBeNull();
});
it("unmount and missing-project refresh preserve a newer Chat panel", () => {
  const view = mount();
  act(() => {
    view.result.current();
  });
  expect(usePanelStore.getState().mobilePanel.target).toBe("file-explorer");
  act(() => {
    usePanelStore.getState().showMobileAgentList();
  });
  const selection = usePanelStore.getState().mobilePanel;
  view.rerender({ ...ready, source: null, cwd: null });
  expect(usePanelStore.getState().mobilePanel).toBe(selection);
  view.unmount();
  expect(usePanelStore.getState().mobilePanel).toBe(selection);
});
it("loss of the current project closes its actually open Files overlay", () => {
  const view = mount();
  act(() => {
    view.result.current();
  });
  const revision = usePanelStore.getState().mobilePanel.revision;
  view.rerender({ ...ready, source: null, cwd: null });
  expect(usePanelStore.getState().mobilePanel).toEqual({
    target: "agent",
    revision: revision + 1,
  });
});
it("leaving the owner closes its open Files and releases the existing owner", () => {
  const view = mount();
  act(() => {
    view.result.current();
  });
  view.rerender({ ...ready, focused: false });
  expect(usePanelStore.getState().mobilePanel.target).toBe("agent");
  expect(useConversationExplorerOwner.getState().owner).toBeNull();
});
it("older cleanup cannot close Files transferred to a newer conversation owner", () => {
  const view = mount();
  act(() => {
    view.result.current();
  });
  mount({ ...ready, layoutKey: "conversation-b" });
  const selection = usePanelStore.getState().mobilePanel;
  view.unmount();
  expect(usePanelStore.getState().mobilePanel).toBe(selection);
  expect(useConversationExplorerOwner.getState().owner).toBe("conversation-b");
});
it("an already queued hardware handler cannot replace a newer Back/list intent", () => {
  const view = mount();
  act(() => {
    view.result.current();
  });
  const handler = native.back.mock.calls.at(-1)?.[1] as () => boolean;
  expect(handler).toBeTypeOf("function");
  act(() => {
    usePanelStore.getState().showMobileAgentList();
  });
  const selection = usePanelStore.getState().mobilePanel;
  act(() => {
    expect(handler()).toBe(false);
  });
  expect(usePanelStore.getState().mobilePanel).toBe(selection);
});
it("desktop missing project hides only its own dock, leaving compact navigation unchanged", () => {
  usePanelStore.getState().showMobileAgentList();
  const selection = usePanelStore.getState().mobilePanel;
  const hide = vi.spyOn(useWorkspaceLayoutStore.getState(), "hideExplorerSidebar");
  mount({ ...ready, singlePanel: false, source: null, cwd: null });
  expect(hide).toHaveBeenCalledWith(ready.layoutKey);
  expect(usePanelStore.getState().mobilePanel).toBe(selection);
});

it("hardware Back still dismisses its currently owned Files overlay", () => {
  const view = mount();
  act(() => {
    view.result.current();
  });
  const handler = native.back.mock.calls.at(-1)?.[1] as () => boolean;
  act(() => {
    expect(handler()).toBe(true);
  });
  expect(usePanelStore.getState().mobilePanel.target).toBe("agent");
});
it("desktop Files toggles the existing dock without closing Chat", () => {
  usePanelStore.getState().showMobileAgentList();
  const selection = usePanelStore.getState().mobilePanel;
  const view = mount({ ...ready, singlePanel: false });
  act(() => {
    view.result.current();
  });
  expect(
    useWorkspaceLayoutStore.getState().explorerSidebarPaneIdByWorkspace[ready.layoutKey],
  ).toBeTruthy();
  expect(usePanelStore.getState().mobilePanel).toBe(selection);
});
