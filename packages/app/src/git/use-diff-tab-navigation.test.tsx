// @vitest-environment jsdom
import { renderHook, act, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDiffTabNavigation } from "./use-diff-tab-navigation";
const mocks = vi.hoisted(() => ({
  conversation: null as null | ReturnType<typeof vi.fn>,
  openTab: vi.fn(),
  openPr: vi.fn(),
}));
vi.mock("@/clisbot/bots/chat/conversation-file-context", () => ({
  useOpenConversationTarget: () => mocks.conversation,
}));
vi.mock("@/stores/workspace-layout-store", () => ({
  FOCUSED_PANE_PLACEMENT: { mode: "focused" },
  useWorkspaceLayoutStore: (select: (state: { openTab: typeof mocks.openTab }) => unknown) =>
    select({ openTab: mocks.openTab }),
}));
vi.mock("@/workspace-tabs/model", () => ({
  buildWorkspaceTabPersistenceKey: ({
    serverId,
    workspaceId,
  }: {
    serverId: string;
    workspaceId: string;
  }) => `${serverId}:${workspaceId}`,
}));
vi.mock("@/workspace-tabs/open-supporting-view", () => ({
  openWorkspacePullRequest: (...args: unknown[]) => mocks.openPr(...args),
}));
beforeEach(() => {
  mocks.conversation = null;
  mocks.openTab.mockReset();
  mocks.openPr.mockReset();
});
afterEach(cleanup);
const input = {
  serverId: "host",
  workspaceId: "bot-b",
  cwd: "/bots/b",
  isMobile: false,
  pullRequestOpenLocation: "main" as const,
};
describe("Changes navigation ownership", () => {
  it.each([false, true])(
    "opens every Changes resource inside the source conversation, mobile=%s",
    (isMobile) => {
      mocks.conversation = vi.fn();
      const { result } = renderHook(() => useDiffTabNavigation({ ...input, isMobile }));
      act(() => {
        result.current.openDiff();
        result.current.openCommit("abc");
        result.current.openPullRequest();
      });
      expect(mocks.conversation.mock.calls).toEqual([
        [{ serverId: "host", workspaceId: "bot-b" }, { kind: "working_diff" }],
        [
          { serverId: "host", workspaceId: "bot-b" },
          { kind: "commit_diff", sha: "abc" },
        ],
        [{ serverId: "host", workspaceId: "bot-b" }, { kind: "pull_request" }],
      ]);
      expect(mocks.openTab).not.toHaveBeenCalled();
      expect(mocks.openPr).not.toHaveBeenCalled();
    },
  );
  it("preserves ordinary desktop workspace routes", () => {
    const { result } = renderHook(() => useDiffTabNavigation(input));
    act(() => {
      result.current.openDiff();
      result.current.openCommit("abc");
      result.current.openPullRequest();
    });
    expect(mocks.openTab.mock.calls.map((call) => call[0].target)).toEqual([
      { kind: "working_diff" },
      { kind: "commit_diff", sha: "abc" },
    ]);
    expect(mocks.openPr).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceKey: "host:bot-b", isCompact: false }),
    );
  });
  it("preserves ordinary mobile inline diff behavior", () => {
    const { result } = renderHook(() => useDiffTabNavigation({ ...input, isMobile: true }));
    act(() => result.current.openDiff());
    expect(mocks.openTab).not.toHaveBeenCalled();
  });
  it("does not escape into cowork when conversation source is unavailable", () => {
    mocks.conversation = vi.fn();
    const { result } = renderHook(() => useDiffTabNavigation({ ...input, workspaceId: null }));
    act(() => result.current.openCommit("abc"));
    expect(mocks.conversation).not.toHaveBeenCalled();
    expect(mocks.openTab).not.toHaveBeenCalled();
  });
});
