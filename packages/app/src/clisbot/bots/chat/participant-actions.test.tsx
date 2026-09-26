// @vitest-environment jsdom
import React, { type ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ParticipantActions } from "./participant-actions";
const navigate = vi.hoisted(() => vi.fn());
vi.mock("@/utils/navigate-to-agent", () => ({ navigateToAgent: navigate }));
vi.mock("@/constants/layout", () => ({ useIsCompactFormFactor: () => true }));
vi.mock("@/constants/platform", () => ({ isNative: false }));
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipTrigger: ({ children }: { children: ReactNode }) => children,
  TooltipContent: () => null,
}));
vi.mock("@/components/adaptive-modal-sheet", () => ({
  AdaptiveModalSheet: ({ visible, children }: { visible: boolean; children: ReactNode }) =>
    visible ? <div role="dialog">{children}</div> : null,
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Pressable: ({
    children,
    onPress,
    accessibilityLabel,
  }: {
    children: ReactNode;
    onPress: () => void;
    accessibilityLabel: string;
  }) => (
    <button type="button" aria-label={accessibilityLabel} onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock("lucide-react-native", () => ({ Monitor: () => <i /> }));
afterEach(() => {
  cleanup();
  navigate.mockClear();
});
const participants = [
  { botId: "a", slug: "a", addedAt: "2026-09-26", displayName: "Analyst", agentId: "agent-a" },
  { botId: "b", slug: "b", addedAt: "2026-09-26", displayName: "Writer", agentId: "agent-b" },
];
it("opens the direct session from one accessible icon without repeating the bot name above the title", () => {
  render(<ParticipantActions serverId="host" participants={participants.slice(0, 1)} />);
  expect(screen.queryByText("Analyst")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Open in cowork" }));
  expect(navigate).toHaveBeenCalledWith({ serverId: "host", agentId: "agent-a" });
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("offers every group participant in a sheet and opens the chosen session", () => {
  render(<ParticipantActions serverId="host" participants={participants} group />);
  fireEvent.click(screen.getByRole("button", { name: "Open in cowork" }));
  expect(screen.getByRole("button", { name: "Analyst" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Writer" }));
  expect(navigate).toHaveBeenCalledWith({ serverId: "host", agentId: "agent-b" });
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("explains an unstarted session without a broken navigation action", () => {
  render(
    <ParticipantActions serverId="host" participants={[{ ...participants[0], agentId: null }]} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Open in cowork" }));
  expect(screen.getByRole("button", { name: "Analyst" }).hasAttribute("disabled")).toBe(true);
  expect(screen.getByText("Send a message to start this bot’s session.")).toBeTruthy();
});
