import { useCallback, useEffect, useRef } from "react";
import { useAppVisible } from "@/hooks/use-app-visible";
import { useSessionStore } from "@/stores/session-store";
import { useAgentUsageQuery } from "./queries";
import {
  mayReadUsageNow,
  readUsageFreshness,
  usagePollInterval,
  type UsageFreshness,
} from "./refresh-policy";
import type { UsageReportEntry } from "./types";

const NO_REPORTS: readonly UsageReportEntry[] = [];

export interface LiveAgentUsage {
  /** The last reports read, kept through failed reads. */
  reports: readonly UsageReportEntry[];
  /** The latest request failed or is waiting for a connection. */
  requestFailed: boolean;
  /** The Host can report usage at all. */
  canReport: boolean;
}

/**
 * An agent's usage for a surface that stays open (the rail's quota): the same query and cache key
 * as the details sheet, kept current by `refresh-policy.ts` instead of read once. It polls while
 * the app is visible, reads again when the window comes back and when the agent's turn ends, and
 * never asks the provider directly: every read is the daemon's cached one.
 */
export function useLiveAgentUsage(serverId: string, agentId: string): LiveAgentUsage {
  const visible = useAppVisible();
  const { canReport, query } = useAgentUsageQuery(serverId, agentId, {
    refetchInterval: (current) =>
      usagePollInterval({
        active: visible,
        freshness: readUsageFreshness(
          current.state.data ?? NO_REPORTS,
          current.state.error !== null,
        ),
        now: Date.now(),
      }),
  });
  const requestFailed = query.error !== null || query.fetchStatus === "paused";
  const read = useReadOnEvent({
    freshness: readUsageFreshness(query.data ?? NO_REPORTS, requestFailed),
    lastAttemptAt: Math.max(query.dataUpdatedAt, query.errorUpdatedAt),
    fetching: query.isFetching,
    refetch: query.refetch,
  });
  // The window came back, or a turn ended.
  useOnChangeTo(visible, true, read);
  useOnChangeTo(useTurnOpen(serverId, agentId), false, read);
  return { reports: query.data ?? NO_REPORTS, requestFailed, canReport };
}

/** A read that an event asks for: it goes out only when the policy allows one now. */
function useReadOnEvent(input: {
  freshness: UsageFreshness;
  lastAttemptAt: number;
  fetching: boolean;
  refetch: () => unknown;
}): () => void {
  const latest = useRef(input);
  useEffect(() => {
    latest.current = input;
  });
  return useCallback(() => {
    const { freshness, lastAttemptAt, fetching, refetch } = latest.current;
    if (fetching) return;
    if (mayReadUsageNow({ freshness, lastAttemptAt, now: Date.now() })) void refetch();
  }, []);
}

/** Whether the agent has a turn running; the end of one is the moment its quota moved. */
function useTurnOpen(serverId: string, agentId: string): boolean {
  return useSessionStore(
    (state) => state.sessions[serverId]?.agents.get(agentId)?.turn.phase === "open",
  );
}

/** Calls `onEdge` when `value` becomes `to`; not for the value a component mounts with. */
function useOnChangeTo(value: boolean, to: boolean, onEdge: () => void): void {
  const previous = useRef(value);
  useEffect(() => {
    const was = previous.current;
    previous.current = value;
    if (was !== value && value === to) onEdge();
  }, [value, to, onEdge]);
}
