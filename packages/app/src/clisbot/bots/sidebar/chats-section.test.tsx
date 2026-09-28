// @vitest-environment jsdom
import React, { type ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatsSection, type ChatsSidebarChat } from "./chats-section";

const env = vi.hoisted(() => ({
  pathname: "/h/host-a/chat/chat-2",
  push: vi.fn(),
  compact: false,
}));
vi.mock("expo-router", () => ({
  usePathname: () => env.pathname,
  useRouter: () => ({ push: env.push }),
}));
vi.mock("react-native", () => ({
  View: ({ children, testID }: { children?: ReactNode; testID?: string }) => (
    <div data-testid={testID}>{children}</div>
  ),
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Pressable: ({
    ref,
    children,
    onPress,
    disabled,
    accessibilityLabel,
    testID,
    ...rest
  }: {
    children?: ReactNode | ((state: { hovered: boolean; pressed: boolean }) => ReactNode);
    ref?: React.Ref<{
      measureInWindow: (
        callback: (x: number, y: number, width: number, height: number) => void,
      ) => void;
    }>;
    onPress?: () => void;
    disabled?: boolean;
    accessibilityLabel?: string;
    testID?: string;
    "aria-selected"?: boolean;
  }) => {
    const attachRef = React.useCallback(() => {
      const handle = {
        measureInWindow: (
          callback: (x: number, y: number, width: number, height: number) => void,
        ) => callback(100, 200, 32, 32),
      };
      if (typeof ref === "function") ref(handle);
      else if (ref) ref.current = handle;
    }, [ref]);
    return (
      <button
        ref={attachRef}
        type="button"
        disabled={disabled}
        aria-label={accessibilityLabel}
        aria-selected={rest["aria-selected"]}
        data-testid={testID}
        onClick={onPress}
      >
        {typeof children === "function" ? children({ hovered: false, pressed: false }) : children}
      </button>
    );
  },
}));
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipTrigger: ({ children }: { children: ReactNode }) => children,
  TooltipContent: () => null,
}));
vi.mock("@/stores/session-store", () => ({
  useSessionStore: () => false,
  selectAgentTurnPresentation: () => ({ isActive: false }),
}));
vi.mock("lucide-react-native", () => ({
  ChevronDown: () => <i />,
  ChevronRight: () => <i />,
  Bot: () => <i />,
  Folder: () => <i />,
  Layers: () => <i />,
  LayoutGrid: () => <i />,
  ListFilter: () => <i />,
  Pin: () => <i />,
  Hash: () => <i />,
  MoreVertical: () => <i />,
  Plus: () => <i />,
}));
vi.mock("@/constants/layout", () => ({ useIsCompactFormFactor: () => env.compact }));
vi.mock("@/constants/platform", () => ({ isNative: false, isWeb: true }));
vi.mock("@/hooks/use-compact-time-ago", () => ({ useCompactTimeAgo: () => "2m" }));
vi.mock("@/components/sidebar/sidebar-group-toggle-row", () => ({
  SidebarGroupToggleRow: ({ expanded, onPress }: { expanded: boolean; onPress: () => void }) => (
    <button type="button" onClick={onPress}>
      {expanded ? "Show less" : "Show more"}
    </button>
  ),
}));

function chat(index: number, overrides: Partial<ChatsSidebarChat> = {}): ChatsSidebarChat {
  return {
    key: `host-a:chat-${index}`,
    serverId: "host-a",
    chatId: `chat-${index}`,
    title: `Chat ${index}`,
    updatedAt: new Date(index * 1000).toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubGlobal("React", React);
  env.push.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ChatsSection", () => {
  it("renders nothing without chats", () => {
    render(<ChatsSection onCreateChat={vi.fn()} chats={[]} />);
    expect(screen.getByRole("button", { name: "Create group chat" })).toBeTruthy();
  });

  it("closes the compact sidebar first, then opens the chat route", () => {
    const close = vi.fn();
    render(
      <ChatsSection onCreateChat={vi.fn()} chats={[chat(1), chat(2)]} onBeforeNavigate={close} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Chat 1" }));
    expect(close).toHaveBeenCalledTimes(1);
    expect(env.push).toHaveBeenCalledWith("/h/host-a/chat/chat-1");
    expect(close.mock.invocationCallOrder[0]).toBeLessThan(env.push.mock.invocationCallOrder[0]!);
  });

  it("fills only the row whose route is current and shows the time and host", () => {
    render(
      <ChatsSection onCreateChat={vi.fn()} chats={[chat(1, { hostLabel: "Host A" }), chat(2)]} />,
    );
    expect(screen.getByRole("button", { name: "Chat 2" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: "Chat 1" }).getAttribute("aria-selected")).toBe(
      "false",
    );
    expect(screen.getAllByText("2m")).toHaveLength(2);
    expect(screen.getByText("Host A")).toBeTruthy();
  });

  it("caps recent chats and toggles the rest", () => {
    render(
      <ChatsSection
        onCreateChat={vi.fn()}
        chats={[1, 2, 3, 4, 5, 6, 7].map((index) => chat(index))}
      />,
    );
    expect(screen.queryByRole("button", { name: "Chat 6" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(screen.getByRole("button", { name: "Chat 7" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show less" }));
    expect(screen.queryByRole("button", { name: "Chat 7" })).toBeNull();
  });

  it("offers the menu only when a handler is given", () => {
    const { rerender } = render(<ChatsSection onCreateChat={vi.fn()} chats={[chat(1)]} />);
    expect(screen.queryByTestId("sidebar-chat-chat-1-menu")).toBeNull();
    const openMenu = vi.fn();
    rerender(<ChatsSection onCreateChat={vi.fn()} chats={[chat(1)]} onOpenChatMenu={openMenu} />);
    fireEvent.click(screen.getByTestId("sidebar-chat-chat-1-menu"));
    expect(openMenu).toHaveBeenCalledWith(expect.objectContaining({ chatId: "chat-1" }), {
      x: 100,
      y: 200,
      width: 32,
      height: 32,
    });
  });
});

it("keeps group creation discoverable but disabled until a bot exists", () => {
  const create = vi.fn();
  render(<ChatsSection chats={[]} onCreateChat={create} canCreateChat={false} />);
  const button = screen.getByRole("button", { name: "Create group chat" });
  expect(button.hasAttribute("disabled")).toBe(true);
  fireEvent.click(button);
  expect(create).not.toHaveBeenCalled();
  expect(screen.getByText("Add at least two bots on one Host to start a group chat.")).toBeTruthy();
});

vi.mock("@/stores/sidebar-collapsed-sections-store", () => ({
  useSidebarCollapsedSectionsStore: (
    select: (state: {
      collapsedWorkspaceGroupKeys: Set<string>;
      toggleWorkspaceGroupCollapsed: () => void;
    }) => unknown,
  ) => select({ collapsedWorkspaceGroupKeys: new Set(), toggleWorkspaceGroupCollapsed: () => {} }),
}));
