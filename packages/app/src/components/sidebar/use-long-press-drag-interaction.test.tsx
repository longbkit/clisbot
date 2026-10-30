// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import type { GestureResponderEvent } from "react-native";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@/constants/platform", () => ({ isWeb: false }));
vi.mock("expo-haptics", () => ({
  selectionAsync: async () => undefined,
  impactAsync: async () => undefined,
  ImpactFeedbackStyle: { Medium: "medium" },
}));
vi.mock("@/performance/native-trace", () => ({ traceInstant: () => undefined }));

const { useLongPressDragInteraction } = await import("./use-long-press-drag-interaction");

function touch(timestamp: number, x = 10, y = 10) {
  return { nativeEvent: { timestamp, pageX: x, pageY: y } } as unknown as GestureResponderEvent;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup() {
  const drag = vi.fn();
  const { result } = renderHook(() => useLongPressDragInteraction({ drag, menuController: null }));
  return { drag, interaction: () => result.current };
}

it("keeps a quick tap a tap when a busy JS thread runs the drag timer before the release", () => {
  const { drag, interaction } = setup();
  act(() => interaction().handlePressIn(touch(1_000)));
  // JS was busy: the 180 ms timer runs before the touch-end that happened at 1 080 ms.
  act(() => vi.advanceTimersByTime(200));
  expect(drag).toHaveBeenCalled();
  act(() => interaction().handlePressOut());
  expect(interaction().consumeLongPress(touch(1_080))).toBe(false);
});

it("swallows the press that ends a real long press", () => {
  const { interaction } = setup();
  act(() => interaction().handlePressIn(touch(1_000)));
  act(() => vi.advanceTimersByTime(200));
  act(() => interaction().handlePressOut());
  expect(interaction().consumeLongPress(touch(1_400))).toBe(true);
  // Consumed once: the next press is judged on its own.
  expect(interaction().consumeLongPress(touch(1_400))).toBe(false);
});

it("swallows a press that scrolled, however quick", () => {
  const { interaction } = setup();
  act(() => interaction().handlePressIn(touch(1_000)));
  act(() => interaction().handleTouchMove(touch(1_020, 10, 60)));
  act(() => interaction().handlePressOut());
  expect(interaction().consumeLongPress(touch(1_050))).toBe(true);
});

it("lets an ordinary tap through", () => {
  const { interaction } = setup();
  act(() => interaction().handlePressIn(touch(1_000)));
  act(() => interaction().handlePressOut());
  expect(interaction().consumeLongPress(touch(1_060))).toBe(false);
});
