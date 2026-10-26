import { useCallback, useEffect, useRef } from "react";
import type { ScrollView, View } from "react-native";

type Measurable = Pick<View, "measureInWindow">;
function measure(view: Measurable): Promise<{ y: number; height: number } | null> {
  let timer: ReturnType<typeof setTimeout>;
  // A View removed during a native measurement may never call back.
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(resolve, 150, null);
  });
  const position = new Promise<{ y: number; height: number }>((resolve) => {
    view.measureInWindow((_x, y, _width, height) => resolve({ y, height }));
  });
  return Promise.race([position, timeout]).finally(() => clearTimeout(timer));
}

async function firstVisibleAnchor(rows: Map<string, View>, surviving: Set<string>, viewport: View) {
  const bounds = await measure(viewport);
  if (!bounds) return;
  const positions = await Promise.all(
    [...rows]
      .filter(([key]) => surviving.has(key))
      .map(async ([key, view]) => ({ key, position: await measure(view) })),
  );
  return positions
    .filter((row) => row.position !== null)
    .sort((a, b) => a.position!.y - b.position!.y)
    .find(
      (row) =>
        row.position!.y + row.position!.height > bounds.y &&
        row.position!.y < bounds.y + bounds.height,
    );
}

interface HeldAnchor {
  rows: Map<string, View>;
  scrollView: ScrollView;
  offset: { current: number };
  frame: { current: number };
  isCurrent(): boolean;
}

/**
 * Scrolls so the anchor row is back at `target.y`, then checks again on the next frames. The
 * change can land over several frames (rows mount, then sections measure), so one correction two
 * frames after the change is not enough on a slow device. A correction that does not move the row
 * means the offset is clamped, and holding stops there.
 */
async function holdAnchor(
  held: HeldAnchor,
  target: { key: string; y: number },
  framesLeft: number,
  scrolledDrift: number | null,
): Promise<void> {
  const view = held.rows.get(target.key);
  const position = view ? await measure(view) : null;
  if (!held.isCurrent()) return;
  const drift = position ? position.y - target.y : 0;
  if (scrolledDrift !== null && Math.abs(drift - scrolledDrift) < 0.5) return;
  let scrolled: number | null = null;
  if (Math.abs(drift) >= 0.5) {
    const y = Math.max(0, held.offset.current + drift);
    held.scrollView.scrollTo({ y, animated: false });
    // onScroll reports this offset later; the next frame must not count the same drift twice.
    held.offset.current = y;
    scrolled = drift;
  }
  if (framesLeft <= 0) return;
  held.frame.current = requestAnimationFrame(() => {
    void holdAnchor(held, target, framesLeft - 1, scrolled);
  });
}

/** Frames the anchor stays held after an apply: about half a second at 60 fps, longer on a slow device. */
const HOLD_FRAMES = 30;

/** Keep the first surviving visible row at its pixel offset when the user applies updates. */
export function useActivityAnchor(offset: { current: number }) {
  const scroll = useRef<ScrollView>(null);
  const viewport = useRef<View>(null);
  const rows = useRef(new Map<string, View>());
  const frame = useRef(0);
  const revision = useRef(0);
  const mounted = useRef(true);
  // A layout-induced clamp also emits onScroll. Only actual input cancels restoration.
  const onUserScroll = useCallback(() => {
    revision.current++;
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancelAnimationFrame(frame.current);
    };
  }, []);
  const register = useCallback((key: string, view: View | null) => {
    if (view) rows.current.set(key, view);
    else rows.current.delete(key);
  }, []);
  const apply = useCallback(
    async (change: () => void, surviving: Set<string>) => {
      const version = ++revision.current;
      cancelAnimationFrame(frame.current);
      const scrollView = scroll.current;
      if (!scrollView || !viewport.current || offset.current <= 2) {
        change();
        return;
      }
      const anchor = await firstVisibleAnchor(rows.current, surviving, viewport.current);
      if (!mounted.current || version !== revision.current) return;
      change();
      if (!anchor) return;
      const isCurrent = () => mounted.current && version === revision.current;
      const target = { key: anchor.key, y: anchor.position!.y };
      const held = { rows: rows.current, scrollView, offset, frame, isCurrent };
      frame.current = requestAnimationFrame(() => {
        frame.current = requestAnimationFrame(() => {
          void holdAnchor(held, target, HOLD_FRAMES, null);
        });
      });
    },
    [offset],
  );
  return { scroll, viewport, register, apply, onUserScroll };
}
