import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Text } from "react-native";
import { RetainedPanel } from "@/components/retained-panel";
import { activeRelativeTimeTickerCount } from "@/utils/relative-time-ticker";
import { useRelativeTimeTick } from "./use-relative-time-tick";

const MINUTE = 60_000;
const START = Date.parse("2026-10-30T12:00:00.000Z");
let renders = 0;

function Clock() {
  renders += 1;
  return <Text testID="now">{String(useRelativeTimeTick({ enabled: true }))}</Text>;
}

let container: HTMLDivElement;
let root: Root;

function render(active: boolean) {
  act(() => {
    root.render(
      <RetainedPanel active={active}>
        <Clock />
      </RetainedPanel>,
    );
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  renders = 0;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("useRelativeTimeTick in a retained panel", () => {
  it("does not tick while hidden and catches up when shown", () => {
    render(false);
    expect(activeRelativeTimeTickerCount()).toBe(0);
    renders = 0;

    act(() => vi.advanceTimersByTime(5 * MINUTE));
    expect(renders).toBe(0);

    render(true);
    expect(activeRelativeTimeTickerCount()).toBe(1);
    expect(container.querySelector('[data-testid="now"]')?.textContent).toBe(
      String(START + 5 * MINUTE),
    );
  });
});
