import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { AgentPermissionResponseRecord } from "@getpaseo/protocol/session-authorship";
import { timelinePageRetention, timelineRetentionKey } from "@/timeline/timeline-page-retention";
import { mergePermissionHistory } from "./permission-history";

const PAGE_SIZE = 20;
const EMPTY: AgentPermissionResponseRecord[] = [];

/** One bounded page at a time; Earlier replaces the window and Recent resets it. */
export function usePermissionHistory(
  client: DaemonClient | null,
  serverId: string,
  agentId: string,
  enabled: boolean,
) {
  const ownerId = useId();
  const [records, setRecords] = useState<AgentPermissionResponseRecord[]>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasOlder, setHasOlder] = useState(false);
  const [viewingOlder, setViewingOlder] = useState(false);
  const [hasNewActivity, setHasNewActivity] = useState(false);
  const [windowKey, setWindowKey] = useState(0);
  const actions = useRef<{ earlier: () => void; recent: () => void } | null>(null);
  const loadOlder = useCallback(() => actions.current?.earlier(), []);
  const loadRecent = useCallback(() => actions.current?.recent(), []);

  useEffect(() => {
    setRecords(EMPTY);
    setHasOlder(false);
    setViewingOlder(false);
    setLoading(false);
    setError(null);
    setHasNewActivity(false);
    if (!client || !enabled) return;
    const key = JSON.stringify([serverId, "permission-history", agentId, ownerId]);
    let current: AgentPermissionResponseRecord[] = [];
    let canceled = false;
    let request = 0;
    let unknownUpdates = 0;
    let nextCursor: number | undefined;
    let windowCursor: number | undefined;
    let requestedCursor: number | undefined;
    let controller: AbortController | null = null;
    const terminalUpdates = new Map<string, AgentPermissionResponseRecord>();
    const publish = (next: AgentPermissionResponseRecord[]) => {
      current = next;
      setRecords(next);
    };
    const clearTerminalUpdates = () => {
      terminalUpdates.clear();
      timelinePageRetention.setPinnedBytes(key, 0);
    };
    let releaseOwner: () => void;
    try {
      releaseOwner = timelinePageRetention.register(
        key,
        () => {
          publish([]);
          nextCursor = undefined;
          setHasOlder(false);
          setError("Permission activity was evicted. Open recent activity to reload.");
        },
        timelineRetentionKey(serverId, agentId),
      );
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Unable to load permission history");
      return;
    }
    timelinePageRetention.setReading(key, true, null);
    const commit = (incoming: AgentPermissionResponseRecord[], replace: boolean) => {
      const incomingIds = new Set(incoming.map((record) => record.id));
      const prior = replace ? current.filter((record) => incomingIds.has(record.id)) : current;
      const merged = mergePermissionHistory(prior, incoming).slice(0, PAGE_SIZE);
      const accepted = timelinePageRetention.retain(key, {
        // A single display-window slot, never a canonical timeline cursor.
        epoch: ownerId,
        startSeq: 1,
        endSeq: 1,
        itemIds: merged.map((record) => record.id),
        sourceSeqRanges: [],
        bytes: 0,
        hasOlder: false,
        itemBytes: Object.fromEntries(
          merged.map((record) => [
            record.id,
            new TextEncoder().encode(JSON.stringify(record)).byteLength * 2 + 256,
          ]),
        ),
      });
      if (!accepted) throw new Error("Permission history exceeds the available memory budget");
      publish(merged);
    };
    const fetchPage = async (cursor: number | undefined) => {
      controller?.abort();
      clearTerminalUpdates();
      const active = new AbortController();
      controller = active;
      requestedCursor = cursor;
      const generation = ++request;
      const initialUnknownUpdates = unknownUpdates;
      setLoading(true);
      setError(null);
      try {
        const response = await client.fetchPermissionResponses(agentId, {
          limit: PAGE_SIZE,
          cursor,
          signal: active.signal,
        });
        if (canceled || generation !== request) return;
        const updated = response.records.map((record) =>
          record.status === "pending" && terminalUpdates.has(record.id)
            ? terminalUpdates.get(record.id)!
            : record,
        );
        commit(updated, true);
        setHasNewActivity(unknownUpdates !== initialUnknownUpdates);
        windowCursor = cursor;
        nextCursor = response.nextCursor;
        setViewingOlder(cursor !== undefined);
        setHasOlder(nextCursor !== undefined);
        setWindowKey((value) => value + 1);
      } catch (failure) {
        if (!canceled && generation === request && !active.signal.aborted)
          setError(
            failure instanceof Error ? failure.message : "Unable to load permission history",
          );
      } finally {
        if (!canceled && generation === request) {
          controller = null;
          clearTerminalUpdates();
          setLoading(false);
        }
      }
    };
    actions.current = {
      earlier: () => {
        if (!controller && nextCursor !== undefined) void fetchPage(nextCursor);
      },
      recent: () => {
        void fetchPage(undefined);
      },
    };
    void fetchPage(undefined);
    const unsubscribe = client.on("agent.permissionResponses.updated", (message) => {
      if (message.payload.agentId !== agentId || canceled) return;
      const record = message.payload.record;
      if (controller && record.status !== "pending") {
        if (!terminalUpdates.has(record.id) && terminalUpdates.size >= PAGE_SIZE) {
          // Restart an overloaded in-flight snapshot instead of retaining an
          // unbounded status map or accepting stale pending acknowledgements.
          void fetchPage(requestedCursor);
        } else {
          const candidate = new Map(terminalUpdates);
          candidate.set(record.id, record);
          const bytes = [...candidate.values()].reduce(
            (total, entry) =>
              total + new TextEncoder().encode(JSON.stringify(entry)).byteLength * 2 + 256,
            0,
          );
          if (timelinePageRetention.setPinnedBytes(key, bytes))
            terminalUpdates.set(record.id, record);
          else void fetchPage(requestedCursor);
        }
      }
      if (!current.some((entry) => entry.id === record.id)) {
        unknownUpdates += 1;
        setHasNewActivity(true);
        if (windowCursor === undefined && !controller) void fetchPage(undefined);
        return;
      }
      try {
        commit([record], false);
      } catch (failure) {
        setError(
          failure instanceof Error ? failure.message : "Unable to update permission history",
        );
      }
    });
    let connected = client.getConnectionState().status === "connected";
    const unsubscribeConnection = client.subscribeConnectionStatus((connection) => {
      const nextConnected = connection.status === "connected";
      if (!nextConnected) {
        controller?.abort();
        request += 1;
        controller = null;
        clearTerminalUpdates();
        setLoading(false);
      }
      if (nextConnected && !connected) {
        publish([]);
        nextCursor = undefined;
        windowCursor = undefined;
        setHasOlder(false);
        setViewingOlder(false);
        void fetchPage(undefined);
      }
      connected = nextConnected;
    });
    return () => {
      canceled = true;
      request += 1;
      controller?.abort();
      actions.current = null;
      unsubscribe();
      unsubscribeConnection();
      releaseOwner();
      current = [];
    };
  }, [client, serverId, agentId, enabled, ownerId]);
  return {
    records,
    loading,
    error,
    hasOlder,
    viewingOlder,
    hasNewActivity,
    windowKey,
    loadOlder,
    loadRecent,
  };
}
