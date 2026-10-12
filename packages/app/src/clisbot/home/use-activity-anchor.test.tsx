// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ScrollView, View } from "react-native";
import { useActivityAnchor } from "./use-activity-anchor";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setup() {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const offset = { current: 1000 };
  const row = { y: 100 };
  const scrollTo = vi.fn();
  const hook = renderHook(() => useActivityAnchor(offset));
  hook.result.current.scroll.current = { scrollTo } as unknown as ScrollView;
  hook.result.current.viewport.current = {
    measureInWindow: (callback) => callback(0, 0, 500, 600),
  } as View;
  hook.result.current.register("survivor", {
    measureInWindow: (callback) => callback(0, row.y, 500, 56),
  } as View);
  const paint = () =>
    act(async () => {
      while (frames.length) {
        for (const frame of frames.splice(0)) frame(0);
        await Promise.resolve();
      }
    });
  return { ...hook, offset, row, scrollTo, paint };
}

test.each([false, true])(
  "removing rows above preserves the anchor, including scroll clamping: %s",
  async (clamped) => {
    const view = setup();
    await act(async () =>
      view.result.current.apply(
        () => {
          // Removing 400px above takes maxScroll from 1200 to 800. The desired offset is 600.
          view.offset.current = clamped ? 800 : 1000;
          view.row.y = clamped ? -100 : -300;
        },
        new Set(["survivor"]),
      ),
    );
    await view.paint();
    expect(view.scrollTo).toHaveBeenCalledExactlyOnceWith({ y: 600, animated: false });
  },
);

test("new scroll input after applying updates cancels restoration without fighting the reader", async () => {
  const view = setup();
  await act(async () =>
    view.result.current.apply(
      () => {
        view.row.y = 200;
      },
      new Set(["survivor"]),
    ),
  );
  act(() => view.result.current.onUserScroll());
  await view.paint();
  expect(view.scrollTo).not.toHaveBeenCalled();
});

test("new input during measurement cancels the pending apply", async () => {
  const view = setup();
  let completeMeasurement!: Parameters<View["measureInWindow"]>[0];
  view.result.current.viewport.current!.measureInWindow = (callback) => {
    completeMeasurement = callback;
  };
  const change = vi.fn();
  const applying = view.result.current.apply(change, new Set(["survivor"]));
  act(() => view.result.current.onUserScroll());
  await act(async () => {
    completeMeasurement(0, 0, 500, 600);
    await applying;
  });
  await view.paint();
  expect(change).not.toHaveBeenCalled();
  expect(view.scrollTo).not.toHaveBeenCalled();
});

test("unmount cancels a queued restoration", async () => {
  const view = setup();
  await act(async () =>
    view.result.current.apply(
      () => {
        view.row.y = 200;
      },
      new Set(["survivor"]),
    ),
  );
  view.unmount();
  await view.paint();
  expect(view.scrollTo).not.toHaveBeenCalled();
});
