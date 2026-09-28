import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}));
import {
  collectAllPanes,
  collectAllTabs,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";
import {
  buildDeterministicWorkspaceTabId,
  normalizeWorkspaceTabTarget,
  workspaceTabTargetsEqual,
} from "@/workspace-tabs/identity";
import {
  conversationLayoutKey,
  openConversationFile,
  withConversationSource,
} from "./conversation-layout";
const sourceA = { serverId: "host", workspaceId: "analyst" };
const sourceB = { serverId: "host", workspaceId: "writer" };
const key = conversationLayoutKey("host", "group", "admission");
const read = (layoutKey = key) => useWorkspaceLayoutStore.getState().layoutByWorkspace[layoutKey]!;
const tabs = (layoutKey = key) => collectAllTabs(read(layoutKey).root);
const open = (path: string, source = sourceA, compact = false, layoutKey = key) =>
  openConversationFile({ layoutKey, source, target: { kind: "file", path }, compact });
beforeEach(() => {
  useWorkspaceLayoutStore.setState({
    layoutByWorkspace: {},
    sidePaneIdByWorkspace: {},
    explorerSidebarPaneIdByWorkspace: {},
  });
  useWorkspaceLayoutStore.getState().openTab({
    workspaceKey: key,
    target: { kind: "conversation", chatId: "group" },
    intent: "background",
  });
});
describe("conversation workspace ownership", () => {
  it("roundtrips source and UI scope without changing ordinary targets", () => {
    const ordinary = { kind: "file" as const, path: "README.md" };
    expect(normalizeWorkspaceTabTarget(ordinary)).toEqual(ordinary);
    expect(buildDeterministicWorkspaceTabId(ordinary)).toBe("file_README.md");
    const target = withConversationSource(ordinary, sourceA, key);
    expect(normalizeWorkspaceTabTarget(JSON.parse(JSON.stringify(target)))).toEqual(target);
    expect(workspaceTabTargetsEqual(target, withConversationSource(ordinary, sourceB, key))).toBe(
      false,
    );
  });
  it("opens first artifact beside Messages and subsequent documents in the same side pane", () => {
    const first = open("README.md");
    const pane = useWorkspaceLayoutStore.getState().sidePaneIdByWorkspace[key];
    const second = open("plan.md");
    expect(collectAllPanes(read().root)).toHaveLength(2);
    const side = collectAllPanes(read().root).find((p) => p.id === pane)!;
    expect(side.tabIds).toEqual([first, second]);
    expect(open("README.md")).toBe(first);
    expect(tabs().filter((tab) => tab.target.kind === "file")).toHaveLength(2);
  });
  it("same file names in different bot workspaces remain independent", () => {
    const first = open("README.md");
    const second = open("README.md", sourceB);
    expect(first).not.toBe(second);
    expect(
      tabs()
        .filter((t) => t.target.kind === "file")
        .map((t) => t.target.workspaceContext),
    ).toEqual([sourceA, sourceB]);
  });
  it("reveals a document where the user moved it without pulling it back", () => {
    const first = open("README.md")!;
    const messagesId = tabs().find((tab) => tab.target.kind === "conversation")!.tabId;
    const main = collectAllPanes(read().root).find((p) => p.tabIds.includes(messagesId))!;
    useWorkspaceLayoutStore.getState().moveTabToPane(key, first, main.id);
    open("README.md");
    expect(collectAllPanes(read().root).find((p) => p.tabIds.includes(first))?.id).toBe(main.id);
  });
  it("mobile keeps one pane and can select Messages after opening a file", () => {
    open("README.md", sourceA, true);
    expect(collectAllPanes(read().root)).toHaveLength(1);
    const message = tabs().find((t) => t.target.kind === "conversation")!;
    useWorkspaceLayoutStore.getState().focusTab(key, message.tabId);
    expect(collectAllPanes(read().root)[0]?.focusedTabId).toBe(message.tabId);
  });
  it("DM and group editors for same source/file never share runtime instance IDs", () => {
    const other = conversationLayoutKey("host", "dm", "admission");
    const first = open("README.md");
    const second = open("README.md", sourceA, true, other);
    expect(first).not.toBe(second);
    expect(tabs().find((tab) => tab.target.kind === "file")?.target.workspaceContext).toEqual(
      sourceA,
    );
    expect(tabs(other).find((tab) => tab.target.kind === "file")?.target.workspaceContext).toEqual(
      sourceA,
    );
  });
  it("restores both same-name documents and their sources through persisted layout reload", () => {
    open("README.md", sourceA, true);
    open("README.md", sourceB, true);
    const options = useWorkspaceLayoutStore.persist.getOptions();
    const persisted = JSON.parse(
      JSON.stringify(options.partialize!(useWorkspaceLayoutStore.getState())),
    );
    useWorkspaceLayoutStore.setState({
      layoutByWorkspace: {},
      sidePaneIdByWorkspace: {},
      explorerSidebarPaneIdByWorkspace: {},
    });
    useWorkspaceLayoutStore.setState(options.merge!(persisted, useWorkspaceLayoutStore.getState()));
    const restored = tabs().filter((tab) => tab.target.kind === "file");
    expect(restored).toHaveLength(2);
    expect(restored.map((tab) => tab.target.workspaceContext)).toEqual([sourceA, sourceB]);
    expect(tabs().some((tab) => tab.target.kind === "conversation")).toBe(true);
  });
});
