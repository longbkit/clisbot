// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ focused: true }));
vi.mock("@react-navigation/native", () => ({ useIsFocused: () => state.focused }));
vi.mock("react-native", () => ({
  View: "div",
  StyleSheet: { create: (value: unknown) => value },
}));
vi.mock("react-native-unistyles", () => ({ StyleSheet: { create: () => ({}) } }));
vi.mock("@/constants/layout", () => ({
  useIsCompactFormFactor: () => true,
  supportsDesktopPaneSplits: () => false,
}));
vi.mock("./use-conversation-layout", () => ({
  useConversationLayout: () => ({ mainTabs: [], layoutKey: "chat" }),
}));
vi.mock("./use-conversation-project", () => ({ useConversationProject: () => ({}) }));
vi.mock("./use-conversation-tabs", () => ({ useConversationTabs: () => ({}) }));
vi.mock("./use-conversation-explorer", () => ({ useConversationExplorer: () => () => {} }));
vi.mock("./conversation-context-providers", () => ({
  ConversationContextProviders: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("./conversation-header", () => ({
  ConversationHeader: () => null,
  ConversationBotSelector: () => null,
  ConversationBotChooser: () => null,
}));
vi.mock("./conversation-surfaces", async () => {
  const { useRetainedPanelActive } = await import("@/components/retained-panel");
  const Surface = () => <div data-testid="surface" data-active={useRetainedPanelActive()} />;
  return { MobileConversationSurface: Surface, DesktopConversationSurface: Surface };
});
import { ConversationWorkspace } from "./conversation-workspace";
afterEach(cleanup);
it("deactivates the whole retained conversation on route blur without unmounting its surface", () => {
  const content = (
    <ConversationWorkspace
      serverId="host"
      chatId="chat"
      accessScope="owner"
      title="Chat"
      bots={[]}
      group={false}
    >
      Messages
    </ConversationWorkspace>
  );
  const view = render(content);
  const surface = screen.getByTestId("surface");
  expect(surface.getAttribute("data-active")).toBe("true");
  state.focused = false;
  view.rerender(React.cloneElement(content));
  expect(screen.getByTestId("surface")).toBe(surface);
  expect(surface.getAttribute("data-active")).toBe("false");
});
