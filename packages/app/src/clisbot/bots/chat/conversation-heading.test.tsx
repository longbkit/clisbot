// @vitest-environment jsdom
import React, { useCallback, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ConversationHeading } from "./conversation-heading";
import { ChatOptionsProvider, useChatOptionsState } from "./chat-options-context";
import { ChatToolActivityHeaderContext } from "./tool-activity-context";
import type { BotToolActivity } from "./tool-activity";

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
// The activity line owns its menu; here only where the heading puts it matters.
vi.mock("./chat-tool-activity-header", () => ({
  ChatToolActivityHeaderLine: ({ context }: { context: string }) => (
    <button type="button">{`Tool activity under ${context}`}</button>
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
const TEAM_MARK = <span>team-mark</span>;
it("opens the same menu state from the heading and the overflow trigger", () => {
  render(
    <ChatOptionsProvider>
      <ConversationHeading
        avatar={TEAM_MARK}
        title="Team"
        group
        memberCount={2}
        hostName="Mac"
        tabCount={2}
      />
      <OptionsTrigger />
    </ChatOptionsProvider>,
  );
  const heading = screen.getByRole("button", {
    name: "Team, 2 members · 2 tabs. Open chat options",
  });
  expect(screen.getByText("team-mark")).toBeTruthy();
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
        avatar={null}
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
        avatar={null}
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
      <ConversationHeading
        avatar={null}
        title="Team"
        group
        memberCount={1}
        hostName="Mac"
        tabCount={1}
      />
    </ChatOptionsProvider>,
  );
  expect(
    screen.getByRole("button", { name: "Team, 1 member · 1 tab. Open chat options" }),
  ).toBeTruthy();
});
const RUNNING = { botId: "a", turnActive: true } as BotToolActivity;
const WITH_ACTIVITY = { serverId: "s", group: false, bots: new Map(), activities: [RUNNING] };
const WITHOUT_ACTIVITY = { serverId: "s", group: false, bots: new Map(), activities: [] };

it("the header tool call display takes the subtitle; the title still opens chat options", () => {
  render(
    <ChatOptionsProvider>
      <ChatToolActivityHeaderContext.Provider value={WITH_ACTIVITY}>
        <ConversationHeading
          avatar={null}
          title="CTO"
          group={false}
          memberCount={1}
          hostName="Long MacBook"
          tabCount={1}
        />
      </ChatToolActivityHeaderContext.Provider>
      <OptionsTrigger />
    </ChatOptionsProvider>,
  );
  expect(screen.getByRole("button", { name: "Tool activity under Long MacBook" })).toBeTruthy();
  expect(screen.queryByText("Long MacBook")).toBeNull();
  const title = screen.getByRole("button", {
    name: "CTO, Long MacBook · 1 tab. Open chat options",
  });
  fireEvent.click(title);
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
});

it("without tool activity the header keeps the Host subtitle", () => {
  render(
    <ChatOptionsProvider>
      <ChatToolActivityHeaderContext.Provider value={WITHOUT_ACTIVITY}>
        <ConversationHeading
          avatar={null}
          title="CTO"
          group={false}
          memberCount={1}
          hostName="Long MacBook"
          tabCount={1}
        />
      </ChatToolActivityHeaderContext.Provider>
    </ChatOptionsProvider>,
  );
  expect(screen.getByText("Long MacBook")).toBeTruthy();
  expect(screen.queryByText(/Tool activity/)).toBeNull();
});

it("a compact identity opens its tab sheet while the overflow keeps Chat options", () => {
  const openTabs = vi.fn();
  render(
    <ChatOptionsProvider>
      <ConversationHeading
        avatar={TEAM_MARK}
        title="Team"
        group
        memberCount={2}
        hostName="Mac"
        tabCount={2}
        onPress={openTabs}
        expanded
      />
      <OptionsTrigger />
    </ChatOptionsProvider>,
  );
  const identity = screen.getByRole("button", { name: "Team. Switch tabs (2 open)" });
  fireEvent.click(identity);
  expect(openTabs).toHaveBeenCalledOnce();
  expect(identity.getAttribute("aria-expanded")).toBe("true");
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "More options" }));
  expect(screen.getByRole("dialog")).toBeTruthy();
});

it("compact tool activity remains a separate trigger from the tab identity", () => {
  const openTabs = vi.fn();
  render(
    <ChatOptionsProvider>
      <ChatToolActivityHeaderContext.Provider value={WITH_ACTIVITY}>
        <ConversationHeading
          avatar={TEAM_MARK}
          title="CTO"
          group={false}
          memberCount={1}
          hostName="Mac"
          tabCount={1}
          onPress={openTabs}
        />
      </ChatToolActivityHeaderContext.Provider>
    </ChatOptionsProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Tool activity under Mac" }));
  expect(openTabs).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "CTO. Switch tabs (1 open)" }));
  expect(openTabs).toHaveBeenCalledOnce();
  expect(
    screen
      .getByRole("button", { name: "Tool activity under Mac" })
      .closest("button")
      ?.querySelector("button"),
  ).toBeNull();
});
