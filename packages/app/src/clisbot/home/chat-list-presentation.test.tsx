// @vitest-environment jsdom
import React, { memo } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const env = vi.hoisted(() => ({
  path: "/chat",
  compact: true,
  listActive: true,
  panelVisible: true,
  selection: null as { serverId: string; workspaceId: string } | null,
  panel: { target: "agent-list", revision: 1 },
  listeners: new Set<() => void>(),
  navigate: vi.fn(),
  back: null as (() => boolean) | null,
}));
vi.mock("@/stores/panel-store", async () => {
  const { useSyncExternalStore } = await import("react");
  const usePanelStore = Object.assign(
    (select: (s: { mobilePanel: typeof env.panel }) => unknown) =>
      useSyncExternalStore(
        (listener) => {
          env.listeners.add(listener);
          return () => {
            env.listeners.delete(listener);
          };
        },
        () => select({ mobilePanel: env.panel }),
      ),
    { getState: () => ({ mobilePanel: env.panel, showMobileAgent: vi.fn() }) },
  );
  return { usePanelStore };
});
vi.mock("@/stores/navigation-active-workspace-store", () => ({
  useActiveWorkspaceSelection: () => env.selection,
}));
vi.mock("expo-router", () => ({
  usePathname: () => env.path,
  useRouter: () => ({ navigate: env.navigate, replace: vi.fn() }),
}));
vi.mock("@/components/ui/control-geometry", () => ({ MIN_TOUCH_TARGET_SIZE: 48 }));
vi.mock("@/components/headers/header-back-button", () => ({ HeaderBackButton: () => null }));
vi.mock("@/components/ui/status-badge", () => ({ StatusBadge: () => null }));
vi.mock("@/mobile-panels/provider", () => ({ useIsMobilePanelActive: () => env.listActive }));
vi.mock("@/constants/layout", () => ({ useIsCompactFormFactor: () => env.compact }));
vi.mock("@/constants/platform", () => ({ isWeb: false }));
vi.mock("./feature", () => ({ HOME_V2_ENABLED: true }));
vi.mock("@/hooks/use-aggregated-agents", () => ({ useAggregatedAgents: () => ({ agents: [] }) }));
vi.mock("@/performance/native-trace", () => ({
  startNativeInputTracing: vi.fn(),
  traceInstant: vi.fn(),
}));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
vi.mock("lucide-react-native", () => ({
  Home: () => null,
  MessageSquare: () => null,
  Inbox: () => null,
  CalendarClock: () => null,
}));
vi.mock("react-native-unistyles", () => ({
  StyleSheet: { create: () => ({}) },
  withUnistyles: (c: unknown) => c,
}));
vi.mock("react-native", () => ({
  View: ({ children, testID }: React.PropsWithChildren<{ testID?: string }>) => (
    <div data-testid={testID}>{children}</div>
  ),
  Text: ({ children }: React.PropsWithChildren) => <span>{children}</span>,
  Pressable: ({
    children,
    accessibilityRole,
    accessibilityState,
  }: React.PropsWithChildren<{
    accessibilityRole?: React.AriaRole;
    accessibilityState?: { selected: boolean };
  }>) => (
    <button type="button" role={accessibilityRole} aria-selected={accessibilityState?.selected}>
      {children}
    </button>
  ),
  BackHandler: {
    addEventListener: (_: string, cb: () => boolean) => {
      env.back = cb;
      return {
        remove: () => {
          env.back = null;
        },
      };
    },
    exitApp: vi.fn(),
  },
}));
import { nativePresentation } from "./chat-list-presentation";
import { MobileChatPanelTabs, MobileHomeTabs } from "./mobile-navigation";
import { startNativeInputTracing } from "@/performance/native-trace";
import {
  WorkspaceSessionsAutoCollapseProvider,
  useSidebarWorkspaceSelection,
} from "../workspace-sessions/auto-collapse";

const path = "/h/host/workspace/a";
const leaf = {
  key: "leaf-a",
  name: "workspace/[workspaceId]/index",
  params: { serverId: "host", workspaceId: "a" },
};
const appear = { target: "leaf-a", data: { closing: false } };
let rowRenders = 0;
const Row = memo(function Row() {
  const selection = useSidebarWorkspaceSelection();
  rowRenders++;
  return (
    <div>
      Existing catalog row
      {selection ? <div data-testid="expanded-session">{selection.workspaceId}</div> : null}
    </div>
  );
});
const row = <Row />;
function Page() {
  return (
    <>
      <div data-testid="root-footer-owner">
        <MobileHomeTabs />
      </div>
      <div data-testid="native-list-panel" hidden={!env.panelVisible}>
        <MobileChatPanelTabs />
        <WorkspaceSessionsAutoCollapseProvider>{row}</WorkspaceSessionsAutoCollapseProvider>
      </div>
    </>
  );
}
beforeEach(() => {
  vi.stubGlobal("React", React);
  env.path = "/chat";
  env.compact = true;
  env.listActive = true;
  env.panelVisible = true;
  env.selection = null;
  env.panel = { target: "agent-list", revision: 1 };
  rowRenders = 0;
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  nativePresentation.cancel();
  vi.unstubAllGlobals();
});

it("keeps the actual Chat footer and unchanged selection projection while native detail is pending", () => {
  const view = render(<Page />),
    close = vi.fn(() => {
      env.panel = { target: "agent", revision: 2 };
      for (const listener of env.listeners) listener();
    });
  expect(screen.getByRole("tab", { name: "Chat" }).getAttribute("aria-selected")).toBe("true");
  const initialRenders = rowRenders;
  act(() => {
    nativePresentation.begin(env.panel as { target: "agent-list"; revision: number }, path, close);
  });
  env.path = path;
  env.selection = { serverId: "host", workspaceId: "a" };
  view.rerender(<Page />);
  expect(screen.getByTestId("home-mobile-tabs")).toBeTruthy();
  expect(screen.getByRole("tab", { name: "Chat" }).getAttribute("aria-selected")).toBe("true");
  expect(screen.queryByTestId("expanded-session")).toBeNull();
  expect(rowRenders).toBe(initialRenders); // No selected-row/context fanout before presentation.
  act(() => {
    nativePresentation.transitionStart(appear, leaf);
    nativePresentation.transitionEnd(
      appear,
      leaf,
      env.panel as { target: "agent-list"; revision: number },
    );
  });
  expect(close).toHaveBeenCalledOnce();
  expect(nativePresentation.getPendingRevision()).toBeNull();
  // Still the last visible list frame: pending=false alone cannot release its geometry.
  expect(screen.getByTestId("home-mobile-tabs")).toBeTruthy();
  expect(screen.queryByTestId("expanded-session")).toBeNull();
  expect(rowRenders).toBe(initialRenders);
  // Native panel visibility changes before its scheduleOnRN settled activity arrives.
  env.panelVisible = false;
  view.rerender(<Page />);
  expect(
    screen
      .getByTestId("home-mobile-tabs")
      .closest("[data-testid=native-list-panel]")
      ?.hasAttribute("hidden"),
  ).toBe(true);
  expect(screen.getByTestId("root-footer-owner").children).toHaveLength(0);
  expect(screen.queryByTestId("expanded-session")).toBeNull();
  env.listActive = false;
  view.rerender(<Page />);
  expect(screen.queryByTestId("home-mobile-tabs")).toBeNull();
  expect(screen.getByTestId("expanded-session").textContent).toBe("a");
});
it("keeps peer footer rendering at root and Back/input tracing in one root owner", () => {
  env.path = "/open-project";
  const view = render(<Page />);
  expect(
    screen.getByTestId("home-mobile-tabs").closest("[data-testid=root-footer-owner]"),
  ).toBeTruthy();
  expect(
    screen.getByTestId("native-list-panel").querySelector("[data-testid=home-mobile-tabs]"),
  ).toBeNull();
  env.path = "/chat";
  view.rerender(<Page />);
  expect(screen.getAllByTestId("home-mobile-tabs")).toHaveLength(1);
  expect(screen.getByTestId("root-footer-owner").children).toHaveLength(0);
  expect(startNativeInputTracing).toHaveBeenCalledOnce();
});
it("preserves selection for an already presented workspace overlay", () => {
  env.path = path;
  env.selection = { serverId: "host", workspaceId: "a" };
  render(<Page />);
  expect(screen.getByTestId("expanded-session").textContent).toBe("a");
  expect(screen.queryByTestId("home-mobile-tabs")).toBeNull();
});
it("a newly opened overlay generation cannot inherit an old outgoing projection", () => {
  const view = render(<Page />);
  act(() => {
    nativePresentation.begin(
      env.panel as { target: "agent-list"; revision: number },
      path,
      vi.fn(),
    );
  });
  env.path = path;
  env.selection = { serverId: "host", workspaceId: "a" };
  act(() => {
    env.panel = { target: "agent-list", revision: 3 };
    for (const listener of env.listeners) listener();
  });
  view.rerender(<Page />);
  expect(screen.queryByTestId("home-mobile-tabs")).toBeNull();
  expect(screen.getByTestId("expanded-session").textContent).toBe("a");
});
it.each([path, "/h/host/workspace"])(
  "hardware Back preserves outgoing Chat while canceling entry at %s",
  (currentPath) => {
    const view = render(<Page />),
      close = vi.fn();
    act(() => {
      nativePresentation.begin(
        env.panel as { target: "agent-list"; revision: number },
        path,
        close,
      );
    });
    env.path = currentPath;
    view.rerender(<Page />);
    act(() => {
      expect(env.back?.()).toBe(true);
    });
    expect(env.navigate).toHaveBeenCalledWith("/chat");
    expect(nativePresentation.getPendingRevision()).toBe(1);
    expect(screen.getByTestId("home-mobile-tabs")).toBeTruthy();
    act(() => {
      nativePresentation.transitionStart(appear, leaf);
      nativePresentation.transitionEnd(
        appear,
        leaf,
        env.panel as { target: "agent-list"; revision: number },
      );
    });
    expect(close).not.toHaveBeenCalled();
    env.path = "/chat";
    view.rerender(<Page />);
    act(() => {
      nativePresentation.didReturnToList();
    });
    expect(nativePresentation.getPendingRevision()).toBeNull();
    expect(screen.getByTestId("home-mobile-tabs")).toBeTruthy();
  },
);

it("keeps desktop selection independent of a compact departure", () => {
  env.compact = false;
  env.path = path;
  env.selection = { serverId: "host", workspaceId: "a" };
  act(() => {
    nativePresentation.begin(
      env.panel as { target: "agent-list"; revision: number },
      path,
      vi.fn(),
    );
  });
  render(<Page />);
  expect(screen.getByTestId("expanded-session").textContent).toBe("a");
  expect(screen.queryByTestId("home-mobile-tabs")).toBeNull();
});
