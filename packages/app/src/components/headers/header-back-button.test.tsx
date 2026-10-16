// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import type { GestureResponderEvent, PressableProps } from "react-native";
import { afterEach, expect, it, vi } from "vitest";

const probe = vi.hoisted(() => ({
  enabled: false,
  props: {} as PressableProps,
  trace: vi.fn(),
  back: vi.fn(),
}));
vi.mock("@/performance/native-trace", () => ({
  nativePerformanceTrace: { isEnabled: () => probe.enabled },
  traceInstant: probe.trace,
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("expo-router", () => ({ router: { back: probe.back } }));
vi.mock("react-native-unistyles", () => ({ withUnistyles: () => () => null }));
vi.mock("@/components/ui/icon-button-chrome", () => ({
  iconButtonChromeGlyphSize: () => 20,
  mutedIconColorMapping: {},
}));
vi.mock("./header-toggle-button", () => ({
  HeaderToggleButton: (props: PressableProps) => {
    probe.props = props;
    return null;
  },
}));
import { HeaderBackButton } from "./header-back-button";
const touch = {
  nativeEvent: { timestamp: 123, pageX: 85, pageY: 225, target: 42 },
} as unknown as GestureResponderEvent;
afterEach(() => {
  cleanup();
  probe.enabled = false;
  vi.clearAllMocks();
});

it("leaves production touch listeners absent and forwards Back once", () => {
  const back = vi.fn();
  render(<HeaderBackButton onBack={back} />);
  for (const key of [
    "onTouchStart",
    "onTouchEnd",
    "onTouchCancel",
    "onPressIn",
    "onPressOut",
    "onLayout",
  ] as const)
    expect(probe.props[key]).toBeUndefined();
  act(() => probe.props.onPress?.(touch));
  expect(back).toHaveBeenCalledTimes(1);
  expect(probe.trace).not.toHaveBeenCalled();
});

it("observes profile input and current layout without adding capture responders or changing forwarding", () => {
  probe.enabled = true;
  const back = vi.fn();
  render(<HeaderBackButton onBack={back} />);
  for (const key of [
    "onStartShouldSetResponderCapture",
    "onMoveShouldSetResponderCapture",
    "onStartShouldSetResponder",
    "onMoveShouldSetResponder",
  ] as const)
    expect(probe.props[key]).toBeUndefined();
  act(() => {
    probe.props.onTouchStart?.(touch);
    probe.props.onPressIn?.(touch);
    probe.props.onPress?.(touch);
    probe.props.onPressOut?.(touch);
    probe.props.onTouchEnd?.(touch);
    probe.props.onTouchCancel?.(touch);
  });
  expect(back).toHaveBeenCalledTimes(1);
  const measureInWindow = vi.fn((callback) => callback(8, 64, 48, 48));
  act(() =>
    probe.props.onLayout?.({
      nativeEvent: { layout: { x: 0, y: 0, width: 48, height: 48 } },
      currentTarget: { measureInWindow },
    } as never),
  );
  expect(measureInWindow).toHaveBeenCalledTimes(1);
  expect(probe.trace).toHaveBeenCalledWith(
    "clisbot.back.bounds",
    expect.objectContaining({ x: "8", y: "64", w: "48", h: "48" }),
  );
  const phases = probe.trace.mock.calls.map(([phase]) => phase);
  expect(phases).toContain("clisbot.back.touchCancel");
  expect(phases.indexOf("clisbot.back.headerEnter")).toBeLessThan(
    phases.indexOf("clisbot.back.headerReturn"),
  );
});
