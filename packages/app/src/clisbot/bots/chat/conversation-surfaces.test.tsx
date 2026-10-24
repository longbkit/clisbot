// @vitest-environment jsdom
import React, { useContext, type ComponentProps } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { SheetTabsProps } from "@/screens/workspace/sheet-tabs";
import { ConversationSheetTabs } from "./conversation-surfaces";
import { ConversationAccessContext, conversationSourceKey } from "./conversation-access";
import { ConversationDraftContext } from "./conversation-draft-context";
import { ConversationFileContext } from "./conversation-file-context";
import { ConversationShellContext } from "./conversation-shell-context";
import { ConversationProjectContext } from "./conversation-project-context";
import {
  ConversationGroupContext,
  ConversationSourceLabelsContext,
} from "./conversation-source-labels";

const mocks = vi.hoisted(() => ({ sheet: null as SheetTabsProps | null }));
vi.mock("@/screens/workspace/sheet-tabs", () => ({
  SheetTabs: (props: SheetTabsProps) => {
    mocks.sheet = props;
    return null;
  },
}));
vi.mock("react-native", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-native")>()),
  View: "div",
  useWindowDimensions: () => ({ width: 390 }),
}));
vi.mock("expo-clipboard", () => ({ setStringAsync: vi.fn() }));
vi.mock("@/components/split-container", () => ({ SplitContainer: () => null }));
vi.mock("@/components/compact-explorer-sidebar", () => ({
  CompactExplorerSidebar: () => null,
  NativeExplorerSidebarDock: () => null,
}));
vi.mock("@/screens/workspace/workspace-panel-host", () => ({ WorkspacePanelHost: () => null }));
vi.mock("@/screens/workspace/compact-workspace-header", () => ({
  MobileWorkspaceTabSwitcher: () => null,
}));
vi.mock("./conversation-heading", () => ({ ConversationHeading: () => null }));
vi.mock("@/stores/session-store", () => ({
  useSessionStore: { getState: () => ({ sessions: {} }) },
}));
vi.mock("@/stores/session-store-hooks/selectors", () => ({
  selectWorkspace: (_state: unknown, serverId: string, workspaceId: string) =>
    serverId === "host" && workspaceId === "writer" ? {} : undefined,
}));

const key = 'conversation:["host","group","owner"]';
const source = { serverId: "host", workspaceId: "writer" };
const draft = { draftKey: "group-draft", focusMessages: vi.fn() };
const open = vi.fn();
const project = {
  serverId: "host",
  cwd: "/writer",
  isGit: true,
  group: true,
  chooseBot: vi.fn(),
};
const labels = new Map([[conversationSourceKey("host", "writer"), "Writer"]]);
const props = {
  serverId: "host",
  focused: true,
  state: { layoutKey: key },
  actions: { buildContent: vi.fn(), closeTab: vi.fn() },
} as unknown as ComponentProps<typeof ConversationSheetTabs>;
function Providers({
  allowed,
  children,
}: {
  allowed: ReadonlySet<string>;
  children: React.ReactNode;
}) {
  return (
    <ConversationAccessContext.Provider value={allowed}>
      <ConversationDraftContext.Provider value={draft}>
        <ConversationFileContext.Provider value={open}>
          <ConversationShellContext.Provider value>
            <ConversationProjectContext.Provider value={project}>
              <ConversationGroupContext.Provider value>
                <ConversationSourceLabelsContext.Provider value={labels}>
                  {children}
                </ConversationSourceLabelsContext.Provider>
              </ConversationGroupContext.Provider>
            </ConversationProjectContext.Provider>
          </ConversationShellContext.Provider>
        </ConversationFileContext.Provider>
      </ConversationDraftContext.Provider>
    </ConversationAccessContext.Provider>
  );
}
function Probe() {
  const access = useContext(ConversationAccessContext);
  const value = useContext(ConversationDraftContext);
  return (
    <div
      data-testid="bridge"
      data-admitted={access.has(conversationSourceKey("host", "writer"))}
      data-draft={value?.draftKey}
      data-shell={useContext(ConversationShellContext)}
      data-opener={useContext(ConversationFileContext) === open}
      data-cwd={useContext(ConversationProjectContext)?.cwd}
      data-source={useContext(ConversationSourceLabelsContext).get(
        conversationSourceKey("host", "writer"),
      )}
    />
  );
}
afterEach(() => {
  cleanup();
  mocks.sheet = null;
});
it("retains live conversation admission, draft and source contexts across a separate portal root", () => {
  const view = render(
    <Providers allowed={new Set(labels.keys())}>
      <ConversationSheetTabs {...props} />
    </Providers>,
  );
  const first = mocks.sheet!;
  expect(first.workspaceKey).toBe(key);
  expect(
    first.canRenderTarget?.({
      kind: "file",
      path: "plan.md",
      workspaceContext: source,
      layoutScope: key,
    }),
  ).toBe(true);
  expect(
    first.canRenderTarget?.({
      kind: "file",
      path: "plan.md",
      workspaceContext: { ...source, serverId: "other" },
      layoutScope: key,
    }),
  ).toBe(false);
  expect(
    first.canRenderTarget?.({
      kind: "file",
      path: "plan.md",
      workspaceContext: source,
      layoutScope: "other-chat",
    }),
  ).toBe(false);
  expect(
    first.canRenderTarget?.({
      kind: "file",
      path: "plan.md",
      workspaceContext: { ...source, workspaceId: "missing" },
      layoutScope: key,
    }),
  ).toBe(false);
  expect(
    first.canRenderTarget?.({
      kind: "user_profile",
      actor: { kind: "user", id: "person" },
      layoutScope: key,
    }),
  ).toBe(true);
  const bridge = first.contextBridge!;
  const portal = render(<>{bridge(<Probe />)}</>); // No original providers surround this root.
  expect(screen.getByTestId("bridge").dataset).toMatchObject({
    admitted: "true",
    draft: "group-draft",
    shell: "true",
    opener: "true",
    cwd: "/writer",
    source: "Writer",
  });
  portal.unmount();
  view.rerender(
    <Providers allowed={new Set()}>
      <ConversationSheetTabs {...props} />
    </Providers>,
  );
  const revoked = mocks.sheet!;
  expect(
    revoked.canRenderTarget?.({
      kind: "file",
      path: "plan.md",
      workspaceContext: source,
      layoutScope: key,
    }),
  ).toBe(false);
  render(<>{revoked.contextBridge!(<Probe />)}</>);
  expect(screen.getByTestId("bridge").dataset.admitted).toBe("false");
});
it("does not mount a hidden retained conversation's sheet host", () => {
  render(
    <Providers allowed={new Set(labels.keys())}>
      <ConversationSheetTabs {...props} focused={false} />
    </Providers>,
  );
  expect(mocks.sheet).toBeNull();
});
