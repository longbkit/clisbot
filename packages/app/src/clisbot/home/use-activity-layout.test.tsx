// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { NativeScrollEvent, NativeSyntheticEvent, PointerEvent } from "react-native";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { useActivityLayout } from "./use-activity-layout";
import { useHomeInteraction } from "./use-home-interaction";
const app = vi.hoisted(() => ({ listener: (_state: string) => {} }));
vi.mock("react-native", () => ({
  AppState: {
    currentState: "active",
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
const day = new Date(2026, 9, 12).toDateString();
function agent(id: string, time: number, status: AggregatedAgent["status"] = "idle") {
  return {
    id,
    serverId: "host",
    status,
    lastActivityAt: new Date(2026, 9, 12, 12, 0, time),
  } as AggregatedAgent;
}
const mouse = { nativeEvent: { pointerType: "mouse" } } as PointerEvent;
const scroll = (y: number) =>
  ({ nativeEvent: { contentOffset: { y } } }) as NativeSyntheticEvent<NativeScrollEvent>;
const keys = (layout: ReturnType<typeof useActivityLayout>["accepted"]) =>
  layout.flatMap((s) => s.keys);

test("hover protects positions while a running row completes and new attention arrives; apply uses latest data", () => {
  vi.useFakeTimers();
  const { result, rerender } = renderHook(
    ({ agents }) => {
      const interaction = useHomeInteraction();
      return { interaction, ...useActivityLayout(agents, day, interaction.automatic) };
    },
    { initialProps: { agents: [agent("running", 1, "running")] } },
  );
  act(() => result.current.interaction.handlers.onPointerEnter(mouse));
  rerender({ agents: [agent("running", 2), agent("approval", 3, "error")] });
  act(() => vi.advanceTimersByTime(5000));
  expect(result.current.accepted[0].key).toBe("active");
  expect(result.current.pending).toBe(2);
  act(() => result.current.accept());
  expect(result.current.accepted[0].key).toBe("needs");
  expect(keys(result.current.accepted)).toEqual(["host:approval", "host:running"]);
  expect(result.current.pending).toBe(0);
});

test("idle top batches arrivals even with continuing stream updates; interaction cancels the scheduled apply", () => {
  vi.useFakeTimers();
  const { result, rerender } = renderHook(
    ({ agents }) => {
      const interaction = useHomeInteraction();
      return { interaction, ...useActivityLayout(agents, day, interaction.automatic) };
    },
    { initialProps: { agents: [agent("running", 1, "running")] } },
  );
  rerender({ agents: [agent("running", 2, "running"), agent("new", 3)] });
  act(() => vi.advanceTimersByTime(500));
  rerender({ agents: [agent("running", 4, "running"), agent("new", 3)] });
  act(() => vi.advanceTimersByTime(250));
  expect(keys(result.current.accepted)).toEqual(["host:running", "host:new"]);
  rerender({ agents: [agent("running", 5)] });
  act(() => result.current.interaction.handlers.onFocus());
  act(() => vi.advanceTimersByTime(3000));
  expect(keys(result.current.accepted)).toEqual(["host:running", "host:new"]);
  act(() => result.current.interaction.handlers.onBlur());
  act(() => vi.advanceTimersByTime(750));
  expect(keys(result.current.accepted)).toEqual(["host:running"]);
});

test("touch cancellation, scroll momentum, away-from-top and background all gate automatic updates", () => {
  vi.useFakeTimers();
  const { result } = renderHook(useHomeInteraction);
  act(() => result.current.handlers.onTouchStart());
  expect(result.current.automatic).toBe(false);
  act(() => result.current.handlers.onTouchCancel());
  expect(result.current.automatic).toBe(true);
  act(() => result.current.onScroll(scroll(300)));
  act(() => vi.advanceTimersByTime(3000));
  expect(result.current.automatic).toBe(false);
  act(() => result.current.onScroll(scroll(0)));
  act(() => vi.advanceTimersByTime(749));
  expect(result.current.automatic).toBe(false);
  act(() => vi.advanceTimersByTime(1));
  expect(result.current.automatic).toBe(true);
  act(() => app.listener("background"));
  expect(result.current.automatic).toBe(false);
  act(() => app.listener("active"));
  expect(result.current.automatic).toBe(true);
});

test("new streaming agents and additional arrivals cannot postpone the first batch deadline", () => {
  vi.useFakeTimers();
  const seed = agent("existing", 0);
  const { result, rerender } = renderHook(({ agents }) => useActivityLayout(agents, day, true), {
    initialProps: { agents: [seed] },
  });
  rerender({ agents: [seed, agent("a", 1, "running"), agent("b", 2, "running")] });
  act(() => vi.advanceTimersByTime(400));
  rerender({ agents: [seed, agent("a", 3, "running"), agent("b", 2, "running")] });
  act(() => vi.advanceTimersByTime(200));
  rerender({
    agents: [
      seed,
      agent("a", 3, "running"),
      agent("b", 2, "running"),
      agent("approval", 4, "error"),
    ],
  });
  act(() => vi.advanceTimersByTime(150));
  expect(keys(result.current.accepted)).toEqual([
    "host:approval",
    "host:a",
    "host:b",
    "host:existing",
  ]);
  expect(result.current.pending).toBe(0);
});

test("a reverted pending batch cancels its timer; the next batch gets its own deadline", () => {
  vi.useFakeTimers();
  const seed = agent("existing", 0);
  const { result, rerender } = renderHook(({ agents }) => useActivityLayout(agents, day, true), {
    initialProps: { agents: [seed] },
  });
  rerender({ agents: [seed, agent("temporary", 1)] });
  act(() => vi.advanceTimersByTime(500));
  rerender({ agents: [seed] });
  act(() => vi.advanceTimersByTime(500));
  rerender({ agents: [seed, agent("next", 2)] });
  act(() => vi.advanceTimersByTime(749));
  expect(keys(result.current.accepted)).toEqual(["host:existing"]);
  act(() => vi.advanceTimersByTime(1));
  expect(keys(result.current.accepted)).toEqual(["host:next", "host:existing"]);
});

test("a held layout whose rows all left takes the rows that arrived at once, even under hover", () => {
  vi.useFakeTimers();
  const { result, rerender } = renderHook(
    ({ agents }) => {
      const interaction = useHomeInteraction();
      return { interaction, ...useActivityLayout(agents, day, interaction.automatic) };
    },
    { initialProps: { agents: [agent("gone", 1)] } },
  );
  act(() => result.current.interaction.handlers.onPointerEnter(mouse));
  rerender({ agents: [agent("fresh", 2), agent("other", 3)] });
  act(() => vi.advanceTimersByTime(0));
  expect(keys(result.current.accepted).sort()).toEqual(["host:fresh", "host:other"]);
  expect(result.current.pending).toBe(0);
});
