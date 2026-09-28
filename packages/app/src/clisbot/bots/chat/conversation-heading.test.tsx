// @vitest-environment jsdom
import React, { useCallback, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ConversationHeading } from "./conversation-heading";
import { ChatOptionsProvider, useChatOptionsState } from "./chat-options-context";

vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Pressable: ({
    children,
    onPress,
    accessibilityLabel,
    ...props
  }: {
    children: ReactNode;
    onPress: () => void;
    accessibilityLabel: string;
    "aria-expanded"?: boolean;
  }) => (
    <button
      type="button"
      aria-label={accessibilityLabel}
      aria-expanded={props["aria-expanded"]}
      onClick={onPress}
    >
      {children}
    </button>
  ),
}));
vi.mock("@/components/headers/screen-title", () => ({
  ScreenTitle: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
afterEach(cleanup);
function OptionsTrigger() {
  const { visible, setVisible } = useChatOptionsState();
  const toggle = useCallback(() => setVisible(!visible), [setVisible, visible]);
  return (
    <>
      <button type="button" onClick={toggle}>
        More options
      </button>
      {visible ? <div role="dialog">Chat options</div> : null}
    </>
  );
}
it("opens the same menu state from the heading and the overflow trigger", () => {
  render(
    <ChatOptionsProvider>
      <ConversationHeading title="Team" group memberCount={2} hostName="Mac" tabCount={2} />
      <OptionsTrigger />
    </ChatOptionsProvider>,
  );
  const heading = screen.getByRole("button", {
    name: "Team, 2 members · 2 tabs. Open chat options",
  });
  fireEvent.click(heading);
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(heading.getAttribute("aria-expanded")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "More options" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(heading.getAttribute("aria-expanded")).toBe("false");
});
it("shows a DM's host and updates the tab count when the layout changes", () => {
  const { rerender } = render(
    <ChatOptionsProvider>
      <ConversationHeading
        title="CTO"
        group={false}
        memberCount={1}
        hostName="Long MacBook"
        tabCount={1}
      />
    </ChatOptionsProvider>,
  );
  expect(
    screen.getByRole("button", { name: "CTO, Long MacBook · 1 tab. Open chat options" }),
  ).toBeTruthy();
  rerender(
    <ChatOptionsProvider>
      <ConversationHeading
        title="CTO"
        group={false}
        memberCount={1}
        hostName="Long MacBook"
        tabCount={3}
      />
    </ChatOptionsProvider>,
  );
  expect(
    screen.getByRole("button", { name: "CTO, Long MacBook · 3 tabs. Open chat options" }),
  ).toBeTruthy();
  expect(screen.queryByText("1 member")).toBeNull();
});
it("uses the group summary even when one member remains", () => {
  render(
    <ChatOptionsProvider>
      <ConversationHeading title="Team" group memberCount={1} hostName="Mac" tabCount={1} />
    </ChatOptionsProvider>,
  );
  expect(
    screen.getByRole("button", { name: "Team, 1 member · 1 tab. Open chat options" }),
  ).toBeTruthy();
});
