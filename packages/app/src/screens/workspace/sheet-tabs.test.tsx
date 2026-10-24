// @vitest-environment jsdom
import React, { createContext, useContext } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SheetTabs } from "./sheet-tabs";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { openConversationFile } from "@/clisbot/bots/chat/conversation-layout";
import type { WorkspacePaneContentModel } from "./workspace-pane-content";

const mocks = vi.hoisted(() => ({ descriptor: vi.fn() }));
vi.mock("expo-router/react-navigation", () => ({ useIsFocused: () => true }));
vi.mock("react-native", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-native")>()),
  View: "div",
}));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
vi.mock("react-native-unistyles", () => ({
  StyleSheet: { create: () => ({}) },
  withUnistyles: (component: unknown) => component,
}));
vi.mock("@/components/adaptive-modal-sheet", () => ({
  SheetBackground: () => null,
  SheetHandle: () => null,
  SheetHeaderIconButton: () => null,
  SheetHeaderView: () => null,
}));
vi.mock("@/panels/register-panels", () => ({ ensurePanelsRegistered: () => {} }));
vi.mock("@/panels/panel-registry", () => ({
  getPanelRegistration: () => ({ useDescriptor: mocks.descriptor }),
}));
vi.mock("./workspace-sheet-environment", () => ({
  useWorkspaceSheetEnvironment: () => (children: React.ReactNode) => (
    <div data-testid="workspace-bridge">{children}</div>
  ),
}));
vi.mock("@/components/ui/isolated-bottom-sheet-modal", async () => {
  const React = await import("react");
  return {
    systemBackPress: { subscribe: () => () => {} },
    IsolatedBottomSheetModal: React.forwardRef(function Modal(
      props: {
        contextBridge: (children: React.ReactNode) => React.ReactNode;
        children: React.ReactNode;
      },
      ref,
    ) {
      React.useImperativeHandle(ref, () => ({ present: () => {}, close: () => {} }));
      return <>{props.contextBridge(props.children)}</>;
    }),
  };
});
const Owner = createContext("missing");
vi.mock("./workspace-pane-content", () => ({ WorkspacePaneContent: () => <Probe /> }));
function Probe() {
  return <div data-testid="body">{useContext(Owner)}</div>;
}
const key = 'conversation:["host","group","owner"]';
const source = { serverId: "host", workspaceId: "writer" };
const emptyContent = {} as WorkspacePaneContentModel;
const buildContent = () => emptyContent;
const closeTab = async () => {};
const bridgeOwner = (children: React.ReactNode) => (
  <Owner.Provider value="chat-draft">{children}</Owner.Provider>
);
const admission = { allowed: false };
const canRenderTarget = () => admission.allowed;
function setup(guard?: () => boolean) {
  return render(
    <SheetTabs
      workspaceKey={key}
      serverId="caller-host"
      workspaceId=""
      isWorkspaceFocused
      buildContent={buildContent}
      onCloseTab={closeTab}
      canRenderTarget={guard}
      contextBridge={bridgeOwner}
    />,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  admission.allowed = false;
  mocks.descriptor.mockReturnValue({ label: "Plan", icon: () => null });
  useWorkspaceLayoutStore.setState({
    layoutByWorkspace: {},
    sheetsByWorkspace: {},
    layoutMode: "compact",
  });
  openConversationFile({
    layoutKey: key,
    source,
    target: { kind: "file", path: "plan.md" },
    compact: true,
  });
});
afterEach(cleanup);
it("uses the authoritative source for descriptors while composing the existing workspace and owner bridges", () => {
  setup();
  expect(mocks.descriptor).toHaveBeenCalledWith(
    expect.objectContaining({ kind: "file", workspaceContext: source }),
    expect.objectContaining(source),
  );
  expect(screen.getByTestId("workspace-bridge").contains(screen.getByTestId("body"))).toBe(true);
  expect(screen.getByTestId("body").textContent).toBe("chat-draft");
});
it("denies revoked targets before descriptor hooks or panel content mount", () => {
  const view = setup(canRenderTarget);
  expect(mocks.descriptor).not.toHaveBeenCalled();
  expect(screen.queryByTestId("body")).toBeNull();
  admission.allowed = true;
  act(() =>
    view.rerender(
      <SheetTabs
        workspaceKey={key}
        serverId="caller"
        workspaceId=""
        isWorkspaceFocused
        buildContent={buildContent}
        onCloseTab={closeTab}
        canRenderTarget={canRenderTarget}
      />,
    ),
  );
  expect(screen.getByTestId("body")).toBeTruthy();
  mocks.descriptor.mockClear();
  admission.allowed = false;
  act(() =>
    view.rerender(
      <SheetTabs
        workspaceKey={key}
        serverId="caller"
        workspaceId=""
        isWorkspaceFocused
        buildContent={buildContent}
        onCloseTab={closeTab}
        canRenderTarget={canRenderTarget}
      />,
    ),
  );
  expect(screen.queryByTestId("body")).toBeNull();
  expect(mocks.descriptor).not.toHaveBeenCalled();
});
