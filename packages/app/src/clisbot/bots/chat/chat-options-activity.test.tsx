// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ChatPayload } from "@clisbot/protocol/chats/types";
interface Children {
  children?: React.ReactNode;
}
const state = vi.hoisted(() => ({ active: true, setVisible: vi.fn() }));
vi.mock("react-native", () => ({ View: "div", Text: "span" }));
vi.mock("react-native-unistyles", () => ({
  StyleSheet: { create: () => ({}) },
  withUnistyles: () => () => null,
}));
vi.mock("@/components/retained-panel", () => ({ useRetainedPanelActive: () => state.active }));
vi.mock("@/components/settings", () => ({ SettingsSection: ({ children }: Children) => children }));
vi.mock("@/components/adaptive-modal-sheet", () => ({
  AdaptiveModalSheet: ({ visible, children }: Children & { visible: boolean }) => (
    <div data-testid="sheet" data-visible={visible}>
      {children}
    </div>
  ),
}));
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: Children) => children,
  DropdownMenuTrigger: ({ children }: Children) => children,
  DropdownMenuContent: ({ children }: Children) => children,
  DropdownMenuItem: ({ children, onSelect }: Children & { onSelect: () => void }) => (
    <button type="button" onClick={onSelect}>
      {children}
    </button>
  ),
  DropdownMenuSubTrigger: () => null,
  DropdownMenuSeparator: () => null,
  DropdownMenuHint: () => null,
}));
vi.mock("@/components/ui/menu", () => ({ MenuTextField: () => null }));
vi.mock("@/components/ui/icon-button-chrome", () => ({
  iconButtonChromeStyle: () => ({}),
  iconButtonChromeGlyphSize: () => 20,
  extraMutedIconColorMapping: {},
  mutedIconColorMapping: {},
}));
vi.mock("@/constants/layout", () => ({ useIsCompactFormFactor: () => true }));
vi.mock("expo-router", () => ({
  useRouter: () => ({ setParams: vi.fn() }),
  usePathname: () => "/",
  useLocalSearchParams: () => ({}),
}));
vi.mock("@/runtime/host-runtime", () => ({ useHostRuntimeClient: () => null }));
vi.mock("@/utils/confirm-dialog", () => ({ confirmDialog: vi.fn() }));
vi.mock("../sidebar/pins", () => ({
  useResourcePins: () => ({ toggle: vi.fn(), isPinned: () => false }),
}));
vi.mock("../data/runtime", () => ({ refreshBotsAndChats: vi.fn() }));
vi.mock("./use-connect-channel", () => ({
  useCanConnectBotToChannel: () => () => false,
  useOpenConnectBotToChannel: () => vi.fn(),
}));
vi.mock("./chat-options-context", () => ({
  useChatOptionsState: () => ({ visible: true, setVisible: state.setVisible }),
}));
vi.mock("./group-chat-settings", () => ({
  GroupChatSettings: () => <input aria-label="Pending group name" defaultValue="Initial" />,
}));
vi.mock("./conversation-project-actions", () => ({ ConversationProjectActions: () => null }));
vi.mock("./chat-participant-settings", () => ({ ChatParticipantSettings: () => null }));
import { ChatOptions } from "./chat-options";
const chat = {
  id: "chat",
  kind: "group",
  participants: [],
  rules: {},
} as unknown as ChatPayload;
afterEach(cleanup);
it("dismisses route-owned sheets and clears their mounted draft when the conversation becomes inactive", () => {
  const element = <ChatOptions serverId="host" chat={chat} bots={[]} />;
  const view = render(element);
  fireEvent.click(screen.getByText("Group settings"));
  expect(screen.getByTestId("sheet").getAttribute("data-visible")).toBe("true");
  fireEvent.change(screen.getByLabelText("Pending group name"), { target: { value: "Unsaved" } });
  state.active = false;
  view.rerender(React.cloneElement(element));
  expect(screen.getByTestId("sheet").getAttribute("data-visible")).toBe("false");
  expect(screen.queryByLabelText("Pending group name")).toBeNull();
  expect(state.setVisible).toHaveBeenCalledWith(false);
  state.active = true;
  view.rerender(React.cloneElement(element));
  expect(screen.getByTestId("sheet").getAttribute("data-visible")).toBe("false");
  expect(screen.queryByLabelText("Pending group name")).toBeNull();
});
