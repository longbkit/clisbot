// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { useLocalDay } from "./use-local-day";
const app = vi.hoisted(() => ({ listener: (_state: string) => {} }));
vi.mock("react-native", () => ({
  AppState: {
    addEventListener: (_event: string, listener: (state: string) => void) => {
      app.listener = listener;
      return { remove: vi.fn() };
    },
  },
}));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
test("a retained Today filter advances at midnight", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 10, 23, 59, 50));
  const { result } = renderHook(useLocalDay);
  act(() => vi.advanceTimersByTime(30000));
  expect(result.current).toBe(new Date(2026, 9, 11).toDateString());
});
test("resume updates the day immediately without waiting for a background timer", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 10));
  const { result } = renderHook(useLocalDay);
  vi.setSystemTime(new Date(2026, 9, 12));
  act(() => app.listener("active"));
  expect(result.current).toBe(new Date(2026, 9, 12).toDateString());
});
