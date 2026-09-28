import { ConversationFileContext } from "./conversation-file-context";
// @vitest-environment jsdom
import React, { useCallback } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useAssistantFileLinkResolverContext } from "@/assistant-file-links/provider";
import { BotWorkspaceContext } from "./bot-workspace-context";

const navigate = vi.hoisted(() => vi.fn());
const openInChat = vi.fn();
vi.mock("@/stores/navigation-active-workspace-store", () => ({ navigateToWorkspace: navigate }));
vi.mock("@/runtime/host-runtime", () => ({ useHostRuntimeClient: () => null }));
afterEach(() => {
  cleanup();
  navigate.mockClear();
});
function LinkConsumer() {
  const { configRef } = useAssistantFileLinkResolverContext();
  const open = useCallback(
    () =>
      configRef.current.onOpenWorkspaceFile?.(
        { raw: "report.md", path: "report.md", lineStart: 12 },
        "preferred",
      ),
    [configRef],
  );
  return (
    <button type="button" onClick={open}>
      {configRef.current.workspaceRoot}
    </button>
  );
}
const botA = { botId: "a", name: "A", cwd: "/bots/a", workspaceId: "wa" };
const botB = { botId: "b", name: "B", cwd: "/bots/b", workspaceId: "wb" };
it("provides the real file-link context and opens each bot's relative file in its own workspace", () => {
  render(
    <ConversationFileContext.Provider value={openInChat}>
      <BotWorkspaceContext serverId="host" bot={botA}>
        <LinkConsumer />
      </BotWorkspaceContext>
      <BotWorkspaceContext serverId="host" bot={botB}>
        <LinkConsumer />
      </BotWorkspaceContext>
    </ConversationFileContext.Provider>,
  );
  fireEvent.click(screen.getByText("/bots/a"));
  fireEvent.click(screen.getByText("/bots/b"));
  expect(navigate).not.toHaveBeenCalled();
  expect(openInChat.mock.calls.map(([input]) => input.workspaceId)).toEqual(["wa", "wb"]);
  expect(openInChat.mock.calls[0]?.[1]).toMatchObject({
    kind: "file",
    path: "report.md",
    lineStart: 12,
  });
});
