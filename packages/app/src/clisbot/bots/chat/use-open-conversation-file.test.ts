// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  workspace: { workspaceDirectory: "/writer" } as {
    workspaceDirectory: string;
    projectKind?: "git" | "non_git";
  } | null,
  open: vi.fn(),
  select: vi.fn(),
  show: vi.fn(),
  explorer: vi.fn(),
  setTree: vi.fn(),
}));
vi.mock("@/stores/session-store", () => ({ useSessionStore: { getState: () => ({}) } }));
vi.mock("@/stores/session-store-hooks/selectors", () => ({
  selectWorkspace: () => mocks.workspace,
}));
vi.mock("@/stores/panel-store", () => ({
  usePanelStore: {
    getState: () => ({
      showMobileAgent: mocks.show,
      openCompactFileExplorer: mocks.explorer,
      setExplorerTabForCheckout: mocks.setTree,
    }),
  },
}));
vi.mock("./conversation-layout", () => ({ openConversationFile: mocks.open }));
vi.mock("./conversation-access", () => ({
  isConversationDocumentTarget: (target: { kind: string }) =>
    ["files", "file", "changes_tree"].includes(target.kind),
}));
import { useOpenConversationFile } from "./use-open-conversation-file";
const source = { serverId: "host", workspaceId: "writer" };
const bots = [{ botId: "writer-bot", name: "Writer", workspaceId: "writer" }];
beforeEach(() => {
  vi.clearAllMocks();
  mocks.workspace = { workspaceDirectory: "/writer" };
});
function setup(singlePanel: boolean) {
  return renderHook(() =>
    useOpenConversationFile({
      serverId: "host",
      bots,
      layoutKey: "chat",
      singlePanel,
      selectBot: mocks.select,
    }),
  ).result.current;
}
it("mobile folder link selects its original bot and opens the existing Explorer", () => {
  setup(true)(source, { kind: "files" });
  expect(mocks.select).toHaveBeenCalledWith("writer-bot");
  expect(mocks.explorer).toHaveBeenCalledWith({ serverId: "host", cwd: "/writer", isGit: false });
  expect(mocks.setTree).toHaveBeenCalledWith(expect.objectContaining({ tab: "files" }));
  expect(mocks.open).not.toHaveBeenCalled();
  expect(mocks.show).not.toHaveBeenCalled();
});
it("mobile file opens a conversation tab and closes Explorer", () => {
  setup(true)(source, { kind: "file", path: "README.md" });
  expect(mocks.open).toHaveBeenCalledWith({
    layoutKey: "chat",
    source,
    target: { kind: "file", path: "README.md" },
    compact: true,
  });
  expect(mocks.show).toHaveBeenCalledOnce();
});
it("mobile changes link selects the source bot and opens Changes in its existing Explorer", () => {
  mocks.workspace = { workspaceDirectory: "/writer", projectKind: "git" };
  setup(true)(source, { kind: "changes_tree" });
  expect(mocks.select).toHaveBeenCalledWith("writer-bot");
  expect(mocks.setTree).toHaveBeenCalledWith({
    serverId: "host",
    cwd: "/writer",
    isGit: true,
    tab: "changes",
  });
  expect(mocks.explorer).toHaveBeenCalledWith({ serverId: "host", cwd: "/writer", isGit: true });
  expect(mocks.open).not.toHaveBeenCalled();
  expect(mocks.show).not.toHaveBeenCalled();
});
it("desktop folder opens scoped Explorer without changing route", () => {
  setup(false)(source, { kind: "files" });
  expect(mocks.open).toHaveBeenCalledWith(expect.objectContaining({ source, compact: false }));
  expect(mocks.explorer).not.toHaveBeenCalled();
});
it("denies revoked project access and foreign Host targets before panel side effects", () => {
  const open = setup(false);
  mocks.workspace = null;
  open(source, { kind: "file", path: "README.md" });
  open({ ...source, serverId: "other" }, { kind: "file", path: "README.md" });
  expect(mocks.open).not.toHaveBeenCalled();
});
