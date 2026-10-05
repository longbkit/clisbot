// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useFollowAnchorOnScroll, useWheelThroughBackdrop } from "./combobox-page-scroll";

vi.mock("@/constants/platform", () => ({ isWeb: true }));

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

/** A page that scrolls, and an open list in the overlay above it. */
function page() {
  const scroller = document.createElement("div");
  scroller.style.overflowY = "auto";
  Object.defineProperty(scroller, "scrollHeight", { value: 2000 });
  Object.defineProperty(scroller, "clientHeight", { value: 500 });
  scroller.scrollBy = vi.fn();
  const field = document.createElement("div");
  scroller.append(field);
  document.body.append(scroller);
  const overlay = document.createElement("div");
  overlay.id = "overlay-root";
  const backdrop = document.createElement("div");
  const list = document.createElement("div");
  overlay.append(backdrop, list);
  document.body.append(overlay);
  // jsdom has no layout: the backdrop sits over the field at every point.
  document.elementsFromPoint = () => [backdrop, overlay, field, scroller, document.body];
  return { scroller, backdrop, list };
}

describe("useWheelThroughBackdrop", () => {
  it("scrolls the page under the pointer and leaves a wheel inside the list to the list", () => {
    const { scroller, backdrop, list } = page();
    const { result } = renderHook(() => useWheelThroughBackdrop(true));
    result.current(list);
    list.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 120 }));
    expect(scroller.scrollBy).not.toHaveBeenCalled();
    backdrop.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 120 }));
    expect(scroller.scrollBy).toHaveBeenCalledWith({ left: 0, top: 120 });
  });

  it("does nothing while the list is closed", () => {
    const { scroller, backdrop } = page();
    renderHook(() => useWheelThroughBackdrop(false));
    backdrop.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 120 }));
    expect(scroller.scrollBy).not.toHaveBeenCalled();
  });
});

describe("useFollowAnchorOnScroll", () => {
  it("re-places the list once per frame while the page scrolls", () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((run) => {
      run(0);
      return 1;
    });
    const follow = vi.fn();
    const { scroller } = page();
    const { unmount } = renderHook(() => useFollowAnchorOnScroll(true, follow));
    scroller.dispatchEvent(new Event("scroll"));
    expect(follow).toHaveBeenCalledTimes(1);
    unmount();
    scroller.dispatchEvent(new Event("scroll"));
    expect(follow).toHaveBeenCalledTimes(1);
  });
});
