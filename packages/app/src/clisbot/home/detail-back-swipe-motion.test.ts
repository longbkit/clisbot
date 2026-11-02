import { describe, expect, it } from "vitest";
import {
  backSwipeOffset,
  backSwipeScrimOpacity,
  resolveBackSwipeRelease,
} from "./detail-back-swipe-motion";

const width = 400;
const release = (translationX: number, velocityX: number, success = true) =>
  resolveBackSwipeRelease({ translationX, velocityX, width, success });

describe("detail back swipe motion", () => {
  it("follows the finger right and never leaves the screen's edges", () => {
    expect(backSwipeOffset(120, width)).toBe(120);
    expect(backSwipeOffset(-30, width)).toBe(0);
    expect(backSwipeOffset(900, width)).toBe(width);
  });

  it("goes Back past a third of the width or on a forward fling", () => {
    expect(release(width / 3 + 1, 0).commit).toBe(true);
    expect(release(40, 900).commit).toBe(true);
    expect(release(width / 3 - 1, 0).commit).toBe(false);
  });

  it("slides home when flung back, canceled, or barely moved", () => {
    expect(release(300, -900).commit).toBe(false);
    expect(release(300, 0, false).commit).toBe(false);
    expect(release(10, 100).commit).toBe(false);
  });

  it("settles in at most a full-width time, faster for a faster finger", () => {
    const slow = release(200, 0);
    const fast = release(200, 4000);
    expect(slow.durationMs).toBe(125);
    expect(fast.durationMs).toBeLessThan(slow.durationMs);
    expect(fast.durationMs).toBeGreaterThanOrEqual(60);
    expect(release(0, 0).durationMs).toBeGreaterThan(0);
    expect(release(width, 0).durationMs).toBeLessThanOrEqual(250);
  });

  it("darkens the tabs underneath only while the detail is off its home", () => {
    expect(backSwipeScrimOpacity(0, width)).toBe(0);
    expect(backSwipeScrimOpacity(width / 2, width)).toBeCloseTo(0.09);
    expect(backSwipeScrimOpacity(width, width)).toBe(0);
  });
});
