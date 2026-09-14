import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { StreamItem } from "@/types/stream";
import { useSessionStore } from "@/stores/session-store";
import type { StreamViewportHandle } from "./strategy";

interface ReadingAnchor {
  itemId: string;
  epoch: string;
  seq: number;
  offset?: number;
}
const EMPTY_ITEMS: readonly StreamItem[] = [];

function matchesAnchor(item: StreamItem, anchor: ReadingAnchor): boolean {
  const cursor = item.timelineCursor;
  return (
    cursor?.epoch === anchor.epoch &&
    (item.id === anchor.itemId || (cursor.seqStart ?? cursor.seq) === anchor.seq)
  );
}
/** The retained pane keeps a position, never another copy of its timeline. */
export function useReadingAnchor(input: {
  serverId: string;
  agentId: string;
  active: boolean;
  nearBottom: boolean;
  ready: boolean;
  items: readonly StreamItem[];
  head?: readonly StreamItem[];
  viewportRef: RefObject<StreamViewportHandle | null>;
  visibleItemIds: ReadonlySet<string>;
  reveal: (itemId: string) => boolean;
}) {
  // Destructured once so every dependency list names a value, not `input.field`.
  const {
    active,
    agentId,
    head = EMPTY_ITEMS,
    items,
    nearBottom,
    ready,
    reveal,
    serverId,
    viewportRef,
    visibleItemIds,
  } = input;
  const saved = useRef<ReadingAnchor | null>(null);
  const lastReported = useRef<ReadingAnchor | null>(null);
  const wasHidden = useRef(false);
  const inFlight = useRef(false);
  const attempted = useRef<ReadingAnchor | null>(null);
  const generation = useRef(0);
  const [pending, setPending] = useState<ReadingAnchor | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const retry = useCallback(() => {
    attempted.current = null;
    setError(null);
    setRevision((value) => value + 1);
  }, []);
  useLayoutEffect(() => {
    generation.current += 1;
    saved.current = null;
    lastReported.current = null;
    wasHidden.current = false;
    setPending(null);
    setError(null);
  }, [serverId, agentId]);
  useLayoutEffect(() => {
    if (!active) {
      generation.current += 1;
      wasHidden.current = true;
      return;
    }
    if (wasHidden.current) {
      wasHidden.current = false;
      setPending(saved.current);
      setError(null);
    }
  }, [active]);
  const report = useCallback(
    (itemId: string | null) => {
      if (!active || wasHidden.current || pending || !itemId) return;
      const item =
        items.find((candidate) => candidate.id === itemId) ??
        head.find((candidate) => candidate.id === itemId);
      const cursor = item?.timelineCursor;
      if (!cursor) return;
      lastReported.current = {
        itemId,
        epoch: cursor.epoch,
        seq: cursor.seqStart ?? cursor.seq,
        offset: viewportRef.current?.getMessageOffset?.(itemId),
      };
      saved.current = nearBottom ? null : lastReported.current;
    },
    [active, nearBottom, items, head, viewportRef, pending],
  );
  useEffect(() => {
    if (active && !pending) saved.current = nearBottom ? null : lastReported.current;
  }, [active, nearBottom, pending]);
  useEffect(() => {
    if (!active || !pending || !ready || error) return;
    const item =
      items.find((candidate) => matchesAnchor(candidate, pending)) ??
      head.find((candidate) => matchesAnchor(candidate, pending));
    if (item) {
      if (!visibleItemIds.has(item.id)) {
        reveal(item.id);
        return;
      }
      viewportRef.current?.scrollToMessage?.(item.id, pending.offset);
      setPending(null);
      return;
    }
    const epoch = useSessionStore
      .getState()
      .sessions[serverId]?.agentTimelineCursor.get(agentId)?.epoch;
    if (epoch && epoch !== pending.epoch) {
      saved.current = null;
      setPending(null);
      return;
    }
    if (inFlight.current || attempted.current === pending) return;
    const restore =
      useSessionStore.getState().sessions[serverId]?.viewedTimelineSync?.restoreReadingAnchor;
    if (!restore) {
      setError("Saved reading position is unavailable");
      return;
    }
    inFlight.current = true;
    attempted.current = pending;
    const requestGeneration = generation.current;
    void restore(agentId, pending)
      .then(() => {
        if (generation.current !== requestGeneration) return undefined;
        const session = useSessionStore.getState().sessions[serverId];
        const found = [
          ...(session?.agentStreamTail.get(agentId) ?? []),
          ...(session?.agentStreamHead.get(agentId) ?? []),
        ].some((candidate) => matchesAnchor(candidate, pending));
        if (!found) setError("Saved reading position is no longer available");
        return undefined;
      })
      .catch((cause: unknown) => {
        if (generation.current === requestGeneration)
          setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        inFlight.current = false;
        setRevision((value) => value + 1);
      });
  }, [
    active,
    ready,
    items,
    head,
    serverId,
    agentId,
    viewportRef,
    visibleItemIds,
    reveal,
    pending,
    error,
    revision,
  ]);
  return { report, restoring: pending !== null, error, retry };
}
