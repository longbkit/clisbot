import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Text } from "react-native";
import { RetainedPanel } from "@/components/retained-panel";
import { activeRelativeTimeTickerCount } from "@/utils/relative-time-ticker";
import { describeCompactTimeAgo } from "@/utils/time";
import { useCompactTimeAgo } from "./use-time-ago";

const MINUTE = 60_000;
const START = new Date("2026-10-30T12:00:00.000Z");
const createdAt = new Date(START.getTime() - 5 * MINUTE);
let renders = 0;

function Label() {
  renders += 1;
  return <Text testID="label">{useCompactTimeAgo(createdAt)}</Text>;
}

let container: HTMLDivElement;
let root: Root;

function render(active: boolean) {
  act(() => {
    root.render(
      <RetainedPanel active={active}>
        <Label />
      </RetainedPanel>,
    );
  });
}

function label(): string {
  return container.querySelector('[data-testid="label"]')?.textContent ?? "";
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

describe("useCompactTimeAgo in a retained panel", () => {
  it("ticks while shown", () => {
    render(true);
    expect(label()).toBe(describeCompactTimeAgo(createdAt).label);
    expect(activeRelativeTimeTickerCount()).toBe(1);

    act(() => vi.advanceTimersByTime(MINUTE));

    expect(label()).toBe(describeCompactTimeAgo(createdAt).label);
    expect(label()).not.toBe(describeCompactTimeAgo(new Date(createdAt.getTime() + MINUTE)).label);
  });

  it("runs no timer and renders nothing while hidden, and shows the current label when shown", () => {
    render(false);
    expect(activeRelativeTimeTickerCount()).toBe(0);
    renders = 0;

    act(() => vi.advanceTimersByTime(10 * MINUTE));
    expect(renders).toBe(0);

    render(true);
    expect(label()).toBe(describeCompactTimeAgo(createdAt).label);
    expect(activeRelativeTimeTickerCount()).toBe(1);
  });
});
