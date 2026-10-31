import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCompactResumeHold } from "./compact-resume-hold";

type AppStateStatus = "active" | "background" | "inactive";

function harness(initialCompact = true) {
  let compact = initialCompact;
  let onChange: ((state: AppStateStatus) => void) | null = null;
  const hold = createCompactResumeHold({
    readCompact: () => compact,
    listenAppState: (listener) => {
      onChange = listener;
      return () => {
        onChange = null;
      };
    },
    settleMs: 1_000,
  });
  return {
    hold,
    setCompact: (value: boolean) => {
      compact = value;
    },
    appState: (state: AppStateStatus) => onChange?.(state),
    listening: () => onChange !== null,
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("compact resume hold", () => {
  it("holds nothing while the app stays in the foreground", () => {
    const { hold } = harness();
    const unsubscribe = hold.subscribe(() => undefined);
    expect(hold.get()).toBeNull();
    unsubscribe();
  });

  it("keeps the compact layout through a size flip while leaving and resuming", () => {
    const { hold, setCompact, appState } = harness(true);
    const listener = vi.fn();
    hold.subscribe(listener);

    appState("background");
    expect(hold.get()).toBe(true);
    // Android reports the launcher's landscape size on the way back.
    setCompact(false);
    appState("active");
    expect(hold.get()).toBe(true);
    vi.advanceTimersByTime(500);
    setCompact(true);
    vi.advanceTimersByTime(500);

    expect(hold.get()).toBeNull();
    expect(listener).toHaveBeenCalled();
  });

  it("releases to the real size once the app has been active long enough", () => {
    const { hold, setCompact, appState } = harness(true);
    hold.subscribe(() => undefined);
    appState("background");
    setCompact(false);
    appState("active");
    vi.advanceTimersByTime(1_000);
    expect(hold.get()).toBeNull();
  });

  it("keeps holding when the app leaves again before it settled", () => {
    const { hold, appState } = harness(true);
    hold.subscribe(() => undefined);
    appState("background");
    appState("active");
    vi.advanceTimersByTime(600);
    appState("background");
    vi.advanceTimersByTime(600);
    expect(hold.get()).toBe(true);
  });

  it("listens to the app state only while subscribed", () => {
    const { hold, listening } = harness();
    const unsubscribe = hold.subscribe(() => undefined);
    expect(listening()).toBe(true);
    unsubscribe();
    expect(listening()).toBe(false);
  });
});
