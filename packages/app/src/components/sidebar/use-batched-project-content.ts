import { useEffect, useMemo, useState } from "react";

const PROJECTS_PER_FRAME = 2;

/** Mount project children in short batches; project data and draggable headers stay complete. */
export function useBatchedProjectContent(
  keys: readonly string[],
  enabled: boolean,
  paused: boolean,
  pausedImmediately?: Readonly<{ current: boolean }>,
): ReadonlySet<string> {
  // Project identities are short, stable strings. Equal keys do not restart a pending frame when
  // a Host update recreates the array during initial hydration.
  const signature = JSON.stringify(keys);
  const stableKeys = useMemo(() => JSON.parse(signature) as string[], [signature]);
  const allReady = useMemo(() => new Set(stableKeys), [stableKeys]);
  const [ready, setReady] = useState<ReadonlySet<string>>(
    () => new Set(enabled ? stableKeys.slice(0, PROJECTS_PER_FRAME) : stableKeys),
  );

  useEffect(() => {
    if (!enabled) return;
    const present = new Set(stableKeys);
    setReady((previous) => {
      if ([...previous].every((key) => present.has(key))) return previous;
      return new Set([...previous].filter((key) => present.has(key)));
    });
  }, [enabled, stableKeys]);

  useEffect(() => {
    if (!enabled || paused) return;
    const pending = stableKeys.filter((key) => !ready.has(key));
    if (pending.length === 0) return;
    const run = () => {
      // Drag can start after this frame was queued but before React commits `paused`.
      if (pausedImmediately?.current) {
        frame = requestAnimationFrame(run);
        return;
      }
      setReady((previous) => new Set([...previous, ...pending.slice(0, PROJECTS_PER_FRAME)]));
    };
    let frame = requestAnimationFrame(run);
    return () => cancelAnimationFrame(frame);
  }, [enabled, paused, pausedImmediately, ready, stableKeys]);

  return enabled ? ready : allReady;
}
