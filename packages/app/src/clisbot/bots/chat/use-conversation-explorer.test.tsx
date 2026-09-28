// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  compact: true,
  web: false,
  open: true,
  showMobileAgent: vi.fn(),
  remove: vi.fn(),
  addEventListener: vi.fn(),
  setExplorerTabForCheckout: vi.fn(),
}));
vi.mock("react-native", () => ({ BackHandler: { addEventListener: mocks.addEventListener } }));
vi.mock("@/constants/platform", () => ({
  get isWeb() {
    return mocks.web;
  },
}));
vi.mock("@/constants/layout", () => ({ useIsCompactFormFactor: () => mocks.compact }));
vi.mock("@/stores/panel-store", () => {
  const state = {
    showMobileAgent: mocks.showMobileAgent,
    setExplorerTabForCheckout: mocks.setExplorerTabForCheckout,
  };
  return {
    selectIsCompactFileExplorerOpen: () => mocks.open,
    usePanelStore: Object.assign((selector: (value: typeof state) => unknown) => selector(state), {
      getState: () => state,
    }),
  };
});
vi.mock("@/stores/workspace-layout-store", () => ({
  useWorkspaceLayoutStore: { getState: () => ({}) },
}));
vi.mock("./conversation-layout", () => ({ withConversationSource: vi.fn() }));
import { useConversationExplorer } from "./use-conversation-explorer";

const source = { serverId: "host", workspaceId: "workspace" };
const props = {
  layoutKey: "chat",
  focused: true,
  singlePanel: true,
  source,
  cwd: "/project",
  isGit: true,
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.compact = true;
  mocks.web = false;
  mocks.open = true;
  mocks.addEventListener.mockReturnValue({ remove: mocks.remove });
});
afterEach(cleanup);

it("dismisses the native compact explorer before Android navigation, and releases Back on blur", () => {
  const hook = renderHook((input) => useConversationExplorer(input), { initialProps: props });
  expect(mocks.addEventListener).toHaveBeenCalledWith("hardwareBackPress", expect.any(Function));
  expect(mocks.addEventListener.mock.calls[0]![1]()).toBe(true);
  expect(mocks.showMobileAgent).toHaveBeenCalledOnce();
  hook.rerender({ ...props, focused: false });
  expect(mocks.remove).toHaveBeenCalledOnce();
});

it.each(["web", "tablet", "closed", "unfocused", "no-project"] as const)(
  "does not intercept navigation for %s",
  (kind) => {
    mocks.web = kind === "web";
    mocks.compact = kind !== "tablet";
    mocks.open = kind !== "closed";
    renderHook(() =>
      useConversationExplorer({
        ...props,
        focused: kind !== "unfocused",
        source: kind === "no-project" ? null : source,
      }),
    );
    expect(mocks.addEventListener).not.toHaveBeenCalled();
  },
);
