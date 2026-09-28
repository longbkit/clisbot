// @vitest-environment jsdom
import React, { type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ChatPayload } from "@getpaseo/protocol/chats/types";
import { GroupChatSettings } from "./group-chat-settings";
const state = vi.hoisted(() => ({ supported: true, online: true, update: vi.fn() }));
vi.mock("@/stores/session-store", () => ({
  useSessionStore: (select: (state: unknown) => unknown) =>
    select({ sessions: { host: { serverInfo: { features: { bots: state.supported } } } } }),
}));
vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeClient: () => ({ updateChat: state.update }),
  useHostRuntimeConnectionStatus: () => (state.online ? "online" : "offline"),
}));
vi.mock("../data/runtime", () => ({ refreshBotsAndChats: vi.fn() }));
vi.mock("@/constants/layout", () => ({ useIsCompactFormFactor: () => true }));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/components/ui/form-field", () => ({
  FormTextInput: ({
    initialValue,
    onChangeText,
    editable,
    accessibilityLabel,
  }: {
    initialValue: string;
    onChangeText: (s: string) => void;
    editable: boolean;
    accessibilityLabel: string;
  }) => {
    const change = React.useCallback(
      (event: React.ChangeEvent<HTMLInputElement>) => onChangeText(event.target.value),
      [onChangeText],
    );
    return (
      <input
        aria-label={accessibilityLabel}
        defaultValue={initialValue}
        onChange={change}
        disabled={!editable}
      />
    );
  },
}));
vi.mock("@/components/ui/select-field", () => ({
  SelectField: ({
    label,
    value,
    options,
    onChange,
    disabled,
  }: {
    label: string;
    value: string;
    options: { id: string; value: string; label: string }[];
    onChange: (s: string) => void;
    disabled: boolean;
  }) => {
    const change = React.useCallback(
      (event: React.ChangeEvent<HTMLSelectElement>) => onChange(event.target.value),
      [onChange],
    );
    return (
      <select aria-label={label} value={value} onChange={change} disabled={disabled}>
        {options.map((option) => (
          <option key={option.id} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  },
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled: boolean;
  }) => (
    <button type="button" onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
}));
const chat = {
  id: "group",
  kind: "group",
  title: "Launch",
  rules: { interaction: { requireMention: false }, rounds: { max: 5 } },
} as ChatPayload;
beforeEach(() => {
  state.supported = true;
  state.online = true;
  state.update.mockReset();
});
afterEach(cleanup);
test("failed save keeps name and reply choice, then retries successfully", async () => {
  const saved = vi.fn();
  state.update.mockResolvedValueOnce({ error: "Try again" }).mockResolvedValueOnce({ error: null });
  render(<GroupChatSettings serverId="host" chat={chat} onSaved={saved} />);
  fireEvent.change(screen.getByLabelText("Group name"), { target: { value: "New launch" } });
  fireEvent.change(screen.getByLabelText("Who replies?"), { target: { value: "mentioned" } });
  fireEvent.click(screen.getByText("Save changes"));
  await screen.findByText("Try again");
  expect((screen.getByLabelText("Group name") as HTMLInputElement).value).toBe("New launch");
  expect((screen.getByLabelText("Who replies?") as HTMLSelectElement).value).toBe("mentioned");
  expect(saved).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Save changes"));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(state.update).toHaveBeenLastCalledWith({
    chatId: "group",
    patch: { title: "New launch", requireMention: true },
  });
});
test("older Hosts explain unavailable editing without sending an unsupported RPC", () => {
  state.supported = false;
  render(<GroupChatSettings serverId="host" chat={chat} onSaved={vi.fn()} />);
  expect(screen.getByText(/does not support editing/)).toBeTruthy();
  expect(screen.queryByText("Save changes")).toBeNull();
  expect(state.update).not.toHaveBeenCalled();
});
test("offline Host disables saving while preserving the draft", () => {
  state.online = false;
  render(<GroupChatSettings serverId="host" chat={chat} onSaved={vi.fn()} />);
  expect((screen.getByText("Save changes") as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText("Connect to this Host to save changes.")).toBeTruthy();
});

test("a dismissed settings form cannot close a later dialog when its save finishes", async () => {
  let finish!: (value: unknown) => void;
  state.update.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const saved = vi.fn();
  const { unmount } = render(<GroupChatSettings serverId="host" chat={chat} onSaved={saved} />);
  fireEvent.change(screen.getByLabelText("Group name"), { target: { value: "New launch" } });
  fireEvent.click(screen.getByText("Save changes"));
  expect(state.update).toHaveBeenCalledOnce();
  unmount();
  await act(async () => {
    finish({ error: null });
  });
  expect(saved).not.toHaveBeenCalled();
});

test("room instructions save with the other settings and keep unchanged ones out", async () => {
  const saved = vi.fn();
  state.update.mockResolvedValueOnce({ error: null });
  render(<GroupChatSettings serverId="host" chat={chat} onSaved={saved} />);
  fireEvent.change(screen.getByLabelText("Room instructions"), {
    target: { value: "  Answer in Vietnamese.  " },
  });
  fireEvent.click(screen.getByText("Save changes"));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(state.update).toHaveBeenLastCalledWith({
    chatId: "group",
    patch: { roomInstructions: "Answer in Vietnamese." },
  });
});

test("the discussion limit saves as roundsMax", async () => {
  const saved = vi.fn();
  state.update.mockResolvedValueOnce({ error: null });
  render(<GroupChatSettings serverId="host" chat={chat} onSaved={saved} />);
  fireEvent.change(screen.getByLabelText("Discussion limit"), { target: { value: "3" } });
  fireEvent.click(screen.getByText("Save changes"));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(state.update).toHaveBeenLastCalledWith({ chatId: "group", patch: { roundsMax: 3 } });
});
