// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CONNECT_STALL_MS } from "./hosts-strip-model";
import { useStallNow, type WaitingHost } from "./connect-stall-clock";

const START = 1_000_000;

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"],
  });
  vi.setSystemTime(START);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** The strip, the rail dot, the More tab, Work, Chats, Home's feed…: one hook each. */
function renderConsumers(count: number, waiting: readonly WaitingHost[]) {
  const renders = Array.from({ length: count }, () => 0);
  const views = renders.map((_, index) =>
    renderHook(() => {
      renders[index]! += 1;
      return useStallNow(waiting);
    }),
  );
  renders.fill(0);
  return { renders, views };
}

it("wakes every consumer once, at the stall, on one shared timer", () => {
  const waiting = [{ since: START }, { since: START + 2_000 }];
  const { renders, views } = renderConsumers(10, waiting);
  expect(vi.getTimerCount()).toBe(1);
  act(() => vi.advanceTimersByTime(CONNECT_STALL_MS));
  expect(renders).toEqual(Array.from({ length: 10 }, () => 0));
  act(() => vi.advanceTimersByTime(1));
  expect(renders).toEqual(Array.from({ length: 10 }, () => 1));
  expect(views[0]!.result.current).toBe(START + CONNECT_STALL_MS + 1);
  // The second Host stalls 2 s later: one more shared wake, then nothing is left to wait for.
  act(() => vi.advanceTimersByTime(2_000));
  expect(renders).toEqual(Array.from({ length: 10 }, () => 2));
  expect(vi.getTimerCount()).toBe(0);
  act(() => vi.advanceTimersByTime(60_000));
  expect(renders).toEqual(Array.from({ length: 10 }, () => 2));
});

it("runs no timer for a Host with no known start", () => {
  const { renders } = renderConsumers(3, [{ since: null }]);
  expect(vi.getTimerCount()).toBe(0);
  act(() => vi.advanceTimersByTime(60_000));
  expect(renders).toEqual([0, 0, 0]);
});

it("stops the timer when its last consumer unmounts", () => {
  const { views } = renderConsumers(2, [{ since: START }]);
  views[0]!.unmount();
  expect(vi.getTimerCount()).toBe(1);
  views[1]!.unmount();
  expect(vi.getTimerCount()).toBe(0);
});
