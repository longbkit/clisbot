// @vitest-environment jsdom
import React, { type ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BotsSection, type BotsSidebarBot } from "./bots-section";

const env = vi.hoisted(() => ({ compact: false }));
vi.mock("react-native", () => ({
  View: ({ children, testID }: { children?: ReactNode; testID?: string }) => (
    <div data-testid={testID}>{children}</div>
  ),
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Pressable: ({
    children,
    onPress,
    accessibilityLabel,
    testID,
    ...rest
  }: {
    children?: ReactNode | ((state: { hovered: boolean; pressed: boolean }) => ReactNode);
    onPress?: () => void;
    accessibilityLabel?: string;
    testID?: string;
    "aria-selected"?: boolean;
  }) => (
    <button
      type="button"
      aria-label={accessibilityLabel}
      aria-selected={rest["aria-selected"]}
      data-testid={testID}
      onClick={onPress}
    >
      {typeof children === "function" ? children({ hovered: false, pressed: false }) : children}
    </button>
  ),
}));
vi.mock("lucide-react-native", () => ({ Ellipsis: () => <i />, Plus: () => <i /> }));
vi.mock("@/constants/layout", () => ({ useIsCompactFormFactor: () => env.compact }));
vi.mock("@/constants/platform", () => ({ isNative: false, isWeb: true }));
vi.mock("../chat/bot-face", () => ({
  BotFace: ({ name }: { name: string }) => <b>{name.charAt(0)}</b>,
}));
// The mocked field forwards to whatever props the row rendered it with last.
const inputProps: {
  onChangeText?: (text: string) => void;
  onSubmitEditing?: () => void;
  onBlur?: () => void;
} = {};
function handleInputChange(event: React.ChangeEvent<HTMLInputElement>) {
  inputProps.onChangeText?.(event.target.value);
}
function handleInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
  if (event.key === "Enter") inputProps.onSubmitEditing?.();
}
function handleInputBlur() {
  inputProps.onBlur?.();
}
vi.mock("@/components/ui/form-field", () => ({
  FormTextInput: (props: {
    placeholder: string;
    accessibilityLabel: string;
    onChangeText: (text: string) => void;
    onSubmitEditing: () => void;
    onBlur: () => void;
  }) => {
    Object.assign(inputProps, props);
    return (
      <input
        aria-label={props.accessibilityLabel}
        placeholder={props.placeholder}
        onChange={handleInputChange}
        onKeyDown={handleInputKeyDown}
        onBlur={handleInputBlur}
      />
    );
  },
}));

function bot(id: string, overrides: Partial<BotsSidebarBot> = {}): BotsSidebarBot {
  return { key: `host-a:${id}`, serverId: "host-a", botId: id, name: `Bot ${id}`, ...overrides };
}

beforeEach(() => {
  vi.stubGlobal("React", React);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("BotsSection", () => {
  it("renders a row per bot, the selected fill, and the active dot", () => {
    render(
      <BotsSection
        bots={[bot("a", { active: true }), bot("b", { hostLabel: "Host A" })]}
        selectedBotKey="host-a:b"
        onPressBot={vi.fn()}
        onCreateBot={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Bot a" }).getAttribute("aria-selected")).toBe(
      "false",
    );
    expect(screen.getByRole("button", { name: "Bot b" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.getByTestId("sidebar-bot-a-active")).toBeTruthy();
    expect(screen.queryByTestId("sidebar-bot-b-active")).toBeNull();
    expect(screen.getByText("Host A")).toBeTruthy();
  });

  it("hands the pressed bot to the caller and its menu to the menu handler", () => {
    const onPressBot = vi.fn();
    const onOpenBotMenu = vi.fn();
    render(
      <BotsSection
        bots={[bot("a")]}
        onPressBot={onPressBot}
        onOpenBotMenu={onOpenBotMenu}
        onCreateBot={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Bot a" }));
    expect(onPressBot).toHaveBeenCalledWith(expect.objectContaining({ botId: "a" }));
    fireEvent.click(screen.getByRole("button", { name: "Bot settings" }));
    expect(onOpenBotMenu).toHaveBeenCalledWith(expect.objectContaining({ botId: "a" }));
  });

  it("turns the New bot row into a name field and submits the typed name on Enter", () => {
    const onCreateBot = vi.fn();
    render(<BotsSection bots={[]} onPressBot={vi.fn()} onCreateBot={onCreateBot} />);
    fireEvent.click(screen.getByRole("button", { name: "New bot" }));
    const input = screen.getByPlaceholderText("Type a name");
    fireEvent.change(input, { target: { value: "  Research bot " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCreateBot).toHaveBeenCalledWith("Research bot");
    expect(screen.getByRole("button", { name: "New bot" })).toBeTruthy();
  });

  it("goes back to the row when the field blurs empty, and creates when it blurs with text", () => {
    const onCreateBot = vi.fn();
    render(<BotsSection bots={[]} onPressBot={vi.fn()} onCreateBot={onCreateBot} />);
    fireEvent.click(screen.getByRole("button", { name: "New bot" }));
    fireEvent.blur(screen.getByPlaceholderText("Type a name"));
    expect(onCreateBot).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "New bot" }));
    const input = screen.getByPlaceholderText("Type a name");
    fireEvent.change(input, { target: { value: "Ops" } });
    fireEvent.blur(input);
    expect(onCreateBot).toHaveBeenCalledWith("Ops");
  });
});
