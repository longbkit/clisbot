vi.mock("@/stores/session-store-hooks", () => ({ useWorkspaceDirectory: () => "/bot-a" }));
// @vitest-environment jsdom
import { renderHook, act, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAddFileToChat } from "./use-add-file-to-chat";
const mocks = vi.hoisted(() => ({
  conversation: false,
  draft: null as null | { draftKey: string; focusMessages: () => void },
  attach: vi.fn(),
  focus: vi.fn(),
  target: { draftKey: "cowork-draft", tabId: "agent-tab" },
}));
vi.mock("@/clisbot/bots/chat/conversation-draft-context", () => ({
  useConversationDraftContext: () => mocks.draft,
}));
vi.mock("@/clisbot/bots/chat/conversation-shell-context", () => ({
  useIsConversationShell: () => mocks.conversation,
}));
vi.mock("@/composer/focused-chat-target", () => ({ resolveFocusedChatTarget: () => mocks.target }));
vi.mock("@/attachments/workspace-file", () => ({
  createWorkspaceFileAttachment: ({ path }: { path: string }) => ({ path }),
}));
vi.mock("@/stores/draft-store", () => ({
  useDraftStore: { getState: () => ({ attachWorkspaceFile: mocks.attach }) },
}));
vi.mock("@/stores/workspace-layout-store", () => ({
  useWorkspaceLayoutStore: (select: (value: unknown) => unknown) =>
    select({ layoutByWorkspace: { work: {} }, focusTab: mocks.focus }),
}));
vi.mock("@/workspace-tabs/model", () => ({ buildWorkspaceTabPersistenceKey: () => "work" }));
beforeEach(() => {
  mocks.conversation = false;
  mocks.draft = null;
  mocks.attach.mockReset();
  mocks.focus.mockReset();
});
afterEach(cleanup);
it("does not attach files to a hidden cowork composer from conversation panels", async () => {
  mocks.conversation = true;
  const { result } = renderHook(() =>
    useAddFileToChat({ serverId: "host", workspaceId: "workspace" }),
  );
  expect(result.current.canAddToChat).toBe(false);
  await act(() => result.current.addFile("README.md"));
  expect(mocks.attach).not.toHaveBeenCalled();
  expect(mocks.focus).not.toHaveBeenCalled();
});
it("retains normal cowork file attachment", async () => {
  const { result } = renderHook(() =>
    useAddFileToChat({ serverId: "host", workspaceId: "workspace" }),
  );
  expect(result.current.canAddToChat).toBe(true);
  await act(() => result.current.addFile("README.md"));
  expect(mocks.attach).toHaveBeenCalledWith({
    draftKey: "cowork-draft",
    attachment: { path: "README.md" },
  });
  expect(mocks.focus).toHaveBeenCalledWith("work", "agent-tab");
});

it("attaches to the owning conversation draft and reveals Messages", async () => {
  mocks.conversation = true;
  const focusMessages = vi.fn();
  mocks.draft = { draftKey: "chat:host:group", focusMessages };
  const { result } = renderHook(() => useAddFileToChat({ serverId: "host", workspaceId: "bot-a" }));
  expect(result.current.canAddToChat).toBe(true);
  await act(() => result.current.addFile("README.md"));
  expect(mocks.attach).toHaveBeenCalledWith({
    draftKey: "chat:host:group",
    attachment: { path: "/bot-a/README.md" },
  });
  expect(focusMessages).toHaveBeenCalled();
  expect(mocks.focus).not.toHaveBeenCalled();
});
