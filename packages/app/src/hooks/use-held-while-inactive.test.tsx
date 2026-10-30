// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useActiveAfterShow, useHeldWhileInactive } from "./use-held-while-inactive";

afterEach(cleanup);

interface Props {
  value: { rows: string[] };
  active: boolean;
}

function renderHeld(initial: Props) {
  const results: Props["value"][] = [];
  const view = renderHook(
    ({ value, active }: Props) => {
      const held = useHeldWhileInactive(value, active);
      results.push(held);
      return held;
    },
    { initialProps: initial },
  );
  return { ...view, results };
}

describe("useHeldWhileInactive", () => {
  it("passes every value through while active", () => {
    const first = { rows: ["a"] };
    const second = { rows: ["a", "b"] };
    const view = renderHeld({ value: first, active: true });
    view.rerender({ value: second, active: true });
    expect(view.result.current).toBe(second);
  });

  it("keeps the identity seen when the pane was hidden across source changes", () => {
    const shown = { rows: ["a"] };
    const view = renderHeld({ value: shown, active: true });
    const hiddenAt = { rows: ["a", "b"] };
    view.rerender({ value: hiddenAt, active: false });
    view.rerender({ value: { rows: ["a", "b", "c"] }, active: false });
    view.rerender({ value: { rows: ["a", "b", "c", "d"] }, active: false });
    expect(view.result.current).toBe(hiddenAt);
  });

  it("holds the first value when it mounts hidden", () => {
    const first = { rows: ["a"] };
    const view = renderHeld({ value: first, active: false });
    view.rerender({ value: { rows: ["b"] }, active: false });
    expect(view.result.current).toBe(first);
  });

  it("returns the latest value in the first render after reactivation", () => {
    const view = renderHeld({ value: { rows: ["a"] }, active: true });
    view.rerender({ value: { rows: ["a"] }, active: false });
    const latest = { rows: ["a", "b", "c"] };
    view.results.length = 0;
    view.rerender({ value: latest, active: true });
    expect(view.results[0]).toBe(latest);
    expect(view.result.current).toBe(latest);
  });

  it("holds again from the value current at the next hide", () => {
    const view = renderHeld({ value: { rows: ["a"] }, active: false });
    view.rerender({ value: { rows: ["b"] }, active: true });
    const second = { rows: ["c"] };
    view.rerender({ value: second, active: false });
    view.rerender({ value: { rows: ["d"] }, active: false });
    expect(view.result.current).toBe(second);
  });
});

describe("useActiveAfterShow", () => {
  function renderActive(active: boolean) {
    const results: boolean[] = [];
    const view = renderHook(
      ({ active: current }: { active: boolean }) => {
        const shown = useActiveAfterShow(current);
        results.push(shown);
        return shown;
      },
      { initialProps: { active } },
    );
    return { ...view, results };
  }

  it("reaches a show one render after the show's own", () => {
    const view = renderActive(false);
    view.results.length = 0;
    view.rerender({ active: true });
    expect(view.results).toEqual([false, true]);
  });

  it("reaches a hide in the hide's own render", () => {
    const view = renderActive(true);
    view.results.length = 0;
    view.rerender({ active: false });
    expect(view.results[0]).toBe(false);
    expect(view.result.current).toBe(false);
  });
});
