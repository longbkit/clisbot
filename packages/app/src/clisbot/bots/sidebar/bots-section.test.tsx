// @vitest-environment jsdom
import React, { type ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BotsSection, type BotsSidebarBot } from "./bots-section";

const env = vi.hoisted(() => ({ compact: false }));
vi.mock("./display/use-row-detail", () => ({
  useBotRowDetail: (row: { hostName?: string }) => row.hostName ?? null,
  useChatRowDetail: (row: { hostName?: string }) => row.hostName ?? null,
}));
vi.mock("./display/section-display-menu", () => ({ SectionDisplayMenu: () => null }));
vi.mock("react-native", () => ({
  View: ({ children, testID }: { children?: ReactNode; testID?: string }) => (
    <div data-testid={testID}>{children}</div>
  ),
  TextInput: () => <input />,
  FlatList: () => null,
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Pressable: ({
    ref,
    children,
    onPress,
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
vi.mock("../chat/bot-face", () => ({
  BotFace: ({ name }: { name: string }) => <b>{name.charAt(0)}</b>,
}));
vi.mock("@/stores/session-store", () => ({
  useSessionStore: () => false,
  selectAgentTurnPresentation: () => ({ isActive: false }),
}));
vi.mock("@/hooks/use-compact-time-ago", () => ({ useCompactTimeAgo: () => "2m" }));
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
        bots={[bot("a", { active: true }), bot("b", { hostName: "Host A" })]}
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
        bots={[bot("a", { canConfigure: true })]}
        onPressBot={onPressBot}
        onOpenBotMenu={onOpenBotMenu}
        onCreateBot={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Bot a" }));
    expect(onPressBot).toHaveBeenCalledWith(expect.objectContaining({ botId: "a" }));
    fireEvent.click(screen.getByRole("button", { name: "Bot options" }));
    expect(onOpenBotMenu).toHaveBeenCalledWith(expect.objectContaining({ botId: "a" }), {
      x: 100,
      y: 200,
      width: 32,
      height: 32,
    });
  });

  it("always offers Create bot in the header without a bottom create row", () => {
    const onCreateBot = vi.fn();
    render(<BotsSection bots={[]} onPressBot={vi.fn()} onCreateBot={onCreateBot} />);
    fireEvent.click(screen.getByRole("button", { name: "Create bot" }));
    expect(onCreateBot).toHaveBeenCalledOnce();
    expect(screen.queryByText("New bot")).toBeNull();
  });
  it("offers pin options for use-only bots and shows private chat time", () => {
    render(
      <BotsSection
        bots={[bot("a", { updatedAt: "2026-09-26T01:00:00Z" })]}
        onPressBot={vi.fn()}
        onOpenBotMenu={vi.fn()}
        onCreateBot={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Bot options" })).toBeTruthy();
    expect(screen.getByText("2m")).toBeTruthy();
  });
});

vi.mock("@/stores/sidebar-collapsed-sections-store", () => ({
  useSidebarCollapsedSectionsStore: (
    select: (state: {
      collapsedWorkspaceGroupKeys: Set<string>;
      toggleWorkspaceGroupCollapsed: () => void;
    }) => unknown,
  ) => select({ collapsedWorkspaceGroupKeys: new Set(), toggleWorkspaceGroupCollapsed: () => {} }),
}));

vi.mock("@/components/adaptive-modal-sheet", () => ({ AdaptiveModalSheet: () => null }));

vi.mock("@/components/ui/form-field", () => ({ FormTextInput: () => <input /> }));
vi.mock("@/components/ui/scroll-view", () => ({ FlatList: () => null }));

vi.mock("./directory-controls", () => ({ DirectoryControls: () => null }));
vi.mock("@/components/ui/loading-spinner", () => ({ LoadingSpinner: () => null }));
