/** @vitest-environment jsdom */
import { useCallback, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { AggregatedBot } from "../data/use-bots";
import { useGroupChatForm } from "./use-group-chat-form";
import { GroupChatForm } from "./group-chat-form";
const state = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@/runtime/host-runtime", () => ({
  getHostRuntimeStore: () => ({
    getClient: () => ({ createChat: state.create }),
    getSnapshot: () => ({ connectionStatus: "online" }),
  }),
}));
vi.mock("../data/runtime", () => ({ refreshBotsAndChats: vi.fn() }));
vi.mock("@/constants/layout", () => ({ useIsCompactFormFactor: () => true }));
vi.mock("react-native", () => ({
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("./form-layout", () => ({
  BotFormLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/ui/form-field", () => ({ FormTextInput: () => null }));
vi.mock("@/components/settings", () => ({
  SettingsCard: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SettingsSwitch: () => null,
}));
vi.mock("@/components/ui/button", () => ({ Button: () => null }));
vi.mock("@/components/ui/select-field", () => ({
  SelectField: ({
    label,
    options,
    onChange,
  }: {
    label: string;
    options: { value: string }[];
    onChange: (value: string) => void;
  }) => {
    const choose = useCallback(() => onChange(options[0]!.value), [onChange, options]);
    return (
      <button type="button" onClick={choose}>
        {label}
      </button>
    );
  },
}));
afterEach(cleanup);
const HOSTS = [
  { serverId: "a", label: "A" },
  { serverId: "b", label: "B" },
];
const BOTS = [
  { id: "bot1", serverId: "a", name: "First" },
  { id: "bot2", serverId: "a", name: "Second" },
] as AggregatedBot[];

test("dismissed group creation does not navigate after its pending request succeeds", async () => {
  let finish!: (value: unknown) => void;
  state.create.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const onCreated = vi.fn();
  const { result, unmount } = renderHook(() =>
    useGroupChatForm({ bots: BOTS, hosts: [HOSTS[0]!], onCreated }),
  );
  act(() => {
    result.current.selectBot("bot1");
    result.current.selectBot("bot2");
  });
  let saving!: Promise<void>;
  act(() => {
    saving = result.current.submit();
  });
  expect(state.create).toHaveBeenCalledOnce();
  unmount();
  await act(async () => {
    finish({ chat: { id: "created" } });
    await saving;
  });
  expect(onCreated).not.toHaveBeenCalled();
});

test("keeps the Host selector available when only an unselected Host remains", () => {
  const onCreated = vi.fn();
  const { rerender } = render(<GroupChatForm hosts={HOSTS} bots={BOTS} onCreated={onCreated} />);
  rerender(<GroupChatForm hosts={[HOSTS[1]!]} bots={BOTS} onCreated={onCreated} />);
  fireEvent.click(screen.getByText("Host"));
  expect(screen.queryByText("Host")).toBeNull();
  // Losing the selected Host also leaves the remaining Host selectable.
  rerender(<GroupChatForm hosts={[HOSTS[0]!]} bots={BOTS} onCreated={onCreated} />);
  expect(screen.getByText("Host")).toBeTruthy();
});
