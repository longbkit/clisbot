// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const focus = vi.hoisted(() => ({ isInteractive: true }));
vi.mock("@/panels/pane-context", () => ({ usePaneFocus: () => focus }));
vi.mock("@/panels/panel-registry", () => ({
  definePanel: (_: string, implementation: unknown) => implementation,
}));
vi.mock("@/components/retained-panel", () => ({
  RetainedPanelActivity: ({ active, children }: { active: boolean; children: React.ReactNode }) => (
    <div data-testid="activity" data-active={active}>
      {children}
    </div>
  ),
}));
import { ConversationContentContext, conversationPanelRegistration } from "./conversation-panel";
afterEach(cleanup);
const content = <span>Existing chat</span>;
it("a visible but unfocused Messages pane does not own composer keyboard actions", () => {
  const Panel = conversationPanelRegistration.component;
  const view = render(
    <ConversationContentContext.Provider value={content}>
      <Panel />
    </ConversationContentContext.Provider>,
  );
  expect(screen.getByTestId("activity").getAttribute("data-active")).toBe("true");
  focus.isInteractive = false;
  view.rerender(
    <ConversationContentContext.Provider value={content}>
      <Panel />
    </ConversationContentContext.Provider>,
  );
  expect(screen.getByTestId("activity").getAttribute("data-active")).toBe("false");
  expect(screen.getByText("Existing chat")).toBeTruthy();
});
