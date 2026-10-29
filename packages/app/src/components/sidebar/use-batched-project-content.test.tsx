/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useBatchedProjectContent } from "./use-batched-project-content";

let frames = new Map<number, FrameRequestCallback>();
let sequence = 0;
function nextFrame() {
  const callbacks = [...frames.values()];
  frames.clear();
  act(() => callbacks.forEach((callback) => callback(16)));
}
beforeEach(() => {
  frames = new Map();
  sequence = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const id = ++sequence;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
});
afterEach(() => vi.unstubAllGlobals());

it("mounts a bounded first batch and eventually every project without changing their order", () => {
  const keys = ["a", "b", "c", "d", "e"];
  const { result } = renderHook(() => useBatchedProjectContent(keys, true, false));
  expect([...result.current]).toEqual(["a", "b"]);
  nextFrame();
  expect([...result.current]).toEqual(["a", "b", "c", "d"]);
  nextFrame();
  expect([...result.current]).toEqual(keys);
  expect(frames.size).toBe(0);
});

it("pauses during drag, resumes after either completion or cancellation, and keeps ready keys on reorder", () => {
  const initial = { keys: ["a", "b", "c", "d", "e"], paused: false };
  const { result, rerender } = renderHook(
    ({ keys, paused }) => useBatchedProjectContent(keys, true, paused),
    { initialProps: initial },
  );
  rerender({ keys: ["e", "b", "a", "c", "d"], paused: true });
  expect([...result.current].sort()).toEqual(["a", "b"]);
  expect(frames.size).toBe(0);
  rerender({ keys: ["e", "b", "a", "c", "d"], paused: false });
  nextFrame();
  expect([...result.current].sort()).toEqual(["a", "b", "c", "e"]);
  nextFrame();
  expect([...result.current].sort()).toEqual(["a", "b", "c", "d", "e"]);
});

it("does not mount a queued batch after drag starts but before React commits the pause", () => {
  const blocked = { current: false };
  const keys = ["a", "b", "c", "d"];
  const { result, rerender } = renderHook(
    ({ paused }) => useBatchedProjectContent(keys, true, paused, blocked),
    { initialProps: { paused: false } },
  );
  blocked.current = true;
  nextFrame();
  expect([...result.current]).toEqual(["a", "b"]);
  rerender({ paused: true });
  blocked.current = false;
  rerender({ paused: false });
  nextFrame();
  expect([...result.current]).toEqual(keys);
});

it("resumes if a short drag starts and ends before React commits either state", () => {
  const blocked = { current: false };
  const keys = ["a", "b", "c", "d"];
  const { result } = renderHook(() => useBatchedProjectContent(keys, true, false, blocked));
  blocked.current = true;
  nextFrame();
  expect([...result.current]).toEqual(["a", "b"]);
  blocked.current = false;
  nextFrame();
  expect([...result.current]).toEqual(keys);
});

it("defers projects introduced by a Host during an already active drag", () => {
  const initial = { keys: ["a", "b"], paused: true };
  const { result, rerender } = renderHook(
    ({ keys, paused }) => useBatchedProjectContent(keys, true, paused),
    { initialProps: initial },
  );
  rerender({ keys: ["a", "b", "c", "d"], paused: true });
  expect([...result.current]).toEqual(["a", "b"]);
  expect(frames.size).toBe(0);
  rerender({ keys: ["a", "b", "c", "d"], paused: false });
  nextFrame();
  expect([...result.current]).toEqual(["a", "b", "c", "d"]);
});

it("reconciles changing projects, bypasses batching when disabled, and cancels after unmount", () => {
  const initial = { keys: ["a", "b", "c"], enabled: true };
  const { result, rerender, unmount } = renderHook(
    ({ keys, enabled }) => useBatchedProjectContent(keys, enabled, false),
    { initialProps: initial },
  );
  rerender({ keys: ["b", "c", "d"], enabled: true });
  nextFrame();
  expect([...result.current].sort()).toEqual(["b", "c", "d"]);
  rerender({ keys: ["x", "y", "z"], enabled: false });
  expect([...result.current]).toEqual(["x", "y", "z"]);
  expect(frames.size).toBe(0);
  rerender({ keys: ["x", "y", "z"], enabled: true });
  unmount();
  expect(frames.size).toBe(0);
});
