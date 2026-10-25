// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { ReactNode } from "react";
import type { GestureType } from "react-native-gesture-handler";
import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  web: false,
  active: false,
  position: { value: -1 },
  close: vi.fn(),
}));
vi.mock("@/constants/platform", () => ({
  get isWeb() {
    return state.web;
  },
}));
vi.mock("@/performance/native-trace", () => ({
  nativePerformanceTrace: { isEnabled: () => false },
  traceInstant: vi.fn(),
}));
vi.mock("react-native-worklets", () => ({ scheduleOnRN: vi.fn() }));
vi.mock("./provider", () => ({
  useIsMobilePanelActive: () => state.active,
  useMobilePanelsRuntime: () => ({ position: state.position, windowWidth: 400 }),
}));
vi.mock("@/stores/panel-store", () => ({
  usePanelStore: (selector: (s: unknown) => unknown) => selector({ showMobileAgent: state.close }),
}));
vi.mock("@/utils/desktop-window", () => ({
  WindowChromeRootRegion: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("react-native-gesture-handler", () => ({
  GestureDetector: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("react-native", async () => {
  const { createElement } = await import("react");
  function View(props: Record<string, unknown>) {
    const styles = (Array.isArray(props.style) ? props.style.flat(Infinity) : [props.style]).filter(
      Boolean,
    );
    const style = Object.assign({}, ...styles);
    return createElement(
      "div",
      {
        "data-pointer": props.pointerEvents,
        "data-style-pointer": style.pointerEvents,
        "data-display": style.display,
        "data-hidden": props.accessibilityElementsHidden,
        "data-testid": props.testID,
        "data-native-id": props.nativeID,
        onClick: props.onPress,
      },
      props.children as ReactNode,
    );
  }
  return {
    View,
    Pressable: View,
    StyleSheet: {
      create: (s: unknown) => s,
      absoluteFill: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
    },
  };
});
vi.mock("react-native-reanimated", async () => {
  const { View } = await import("react-native");
  return {
    default: { View },
    useAnimatedStyle: (fn: () => unknown) => fn(),
    useAnimatedReaction: vi.fn(),
  };
});
import { MobilePanelOverlay } from "./presentation";
const gesture = {} as GestureType;
const press = vi.fn();
function renderPanel(presented = true) {
  return render(
    <MobilePanelOverlay panel="agent-list" closeGesture={gesture} presented={presented}>
      <button type="button" onClick={press}>
        Session
      </button>
    </MobilePanelOverlay>,
  );
}
function ancestors(node: HTMLElement) {
  const result: HTMLElement[] = [];
  for (let current: HTMLElement | null = node; current; current = current.parentElement)
    result.push(current);
  return result;
}
afterEach(() => {
  cleanup();
  state.web = false;
  state.active = false;
  state.position.value = -1;
  vi.clearAllMocks();
});
it("allows native visible descendants before settled activity publication", () => {
  const view = renderPanel();
  const row = view.getByRole("button", { name: "Session" });
  expect(
    ancestors(row).some((n) => n.dataset.pointer === "none" || n.dataset.stylePointer === "none"),
  ).toBe(false);
  const hosts = view.container.querySelectorAll('[data-native-id^="agent-list-gesture-host-"]');
  expect(hosts).toHaveLength(1);
  const host = hosts[0];
  expect(
    Array.from(host?.firstElementChild?.children ?? []).map((n) => n.getAttribute("data-pointer")),
  ).toEqual(["auto", "auto"]);
  expect(host?.getAttribute("data-hidden")).toBe("true"); // Accessibility still follows settled activity.
  fireEvent.click(row);
  expect(press).toHaveBeenCalledTimes(1);
});
it("blocks native hidden descendants even while stale settled activity still says open", () => {
  state.position.value = 0;
  state.active = true;
  const view = renderPanel();
  expect(ancestors(view.getByRole("button")).some((n) => n.dataset.stylePointer === "none")).toBe(
    true,
  );
});
it("keeps the global-screen host guard above a still-visible native position", () => {
  state.active = true;
  const view = renderPanel(false);
  expect(ancestors(view.getByRole("button")).some((n) => n.dataset.pointer === "none")).toBe(true);
});
it("preserves web child eligibility until settled publication", () => {
  state.web = true;
  const view = renderPanel();
  expect(ancestors(view.getByRole("button")).some((n) => n.dataset.pointer === "none")).toBe(true);
});
