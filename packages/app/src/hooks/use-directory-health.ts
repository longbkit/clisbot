import { useMemo } from "react";
import { type HubSourceHealth, useHubSourceHealth } from "@/clisbot/hub/hub-source-health";
import type { SourceHealth } from "@/runtime/source-health";
import {
  describeSourceProblem,
  resolveSourceStatus,
  type SourceStatus,
  useSourceHealthEntries,
} from "./use-source-health";

export type DirectoryHealth = {
  hasAcceptedResult: boolean;
  /** Selected sources that cannot refresh now; the aggregate stays usable while others can. */
  degraded?: { serverIds: string[]; total: number };
} & (
  | { status: "loading" | "refreshing" | "ready"; message: null; serverId: null }
  | { status: "unavailable"; message: string; serverId: string; recovery: "retry" | "connection" }
);

type DirectoryKind = "agents" | "workspaces";

/**
 * One aggregate line over the selected sources. A single source never makes it "loading" or
 * "unavailable" while another source can serve: it is `unavailable` only when no selected source
 * can refresh, and `loading` only when none has anything to show yet. Per-source detail lives in
 * `useSourceHealthSummary`. Reads debounced per-source health, so a blip does not flicker it.
 */
export function useDirectoryHealth(
  serverIds?: readonly string[],
  kind: DirectoryKind = "agents",
): DirectoryHealth {
  const entries = useSourceHealthEntries(serverIds);
  const hubs = useHubSourceHealth();
  return useMemo(() => projectDirectoryHealth(entries, hubs, kind), [entries, hubs, kind]);
}

export function projectDirectoryHealth(
  entries: readonly SourceHealth[],
  hubs: readonly HubSourceHealth[],
  kind: DirectoryKind,
): DirectoryHealth {
  const hubByOrigin = new Map(hubs.map((hub) => [hub.origin, hub]));
  const sources = entries.map((entry) =>
    resolveSourceStatus(
      entry,
      entry.hubOrigin === null ? undefined : hubByOrigin.get(entry.hubOrigin),
    ),
  );
  const hasAcceptedResult = sources.every((source) => source[kind].loaded);
  const failed = sources.filter((source) => failureOf(source, kind) !== null);
  const degraded = failed.length
    ? { serverIds: failed.map((source) => source.serverId), total: sources.length }
    : undefined;
  const usable = sources.filter((source) => failureOf(source, kind) === null);
  if (sources.length > 0 && usable.length === 0) {
    const first = failed[0]!;
    const failure = failureOf(first, kind)!;
    return {
      hasAcceptedResult,
      status: "unavailable",
      serverId: first.serverId,
      recovery: failure.recovery,
      message:
        failure.recovery === "retry"
          ? `${first.label}: ${failure.message}`
          : describeSourceProblem(first, hubLabel(first, hubByOrigin)),
    };
  }
  const busy = (source: SourceStatus) =>
    !source.online || source[kind].syncing || source[kind].pending;
  let status: "loading" | "refreshing" | "ready" = "ready";
  if (usable.length > 0 && usable.every(busy))
    status = usable.some((source) => source[kind].loaded) ? "refreshing" : "loading";
  return {
    hasAcceptedResult,
    ...(degraded ? { degraded } : {}),
    status,
    message: null,
    serverId: null,
  };
}

function failureOf(
  source: SourceStatus,
  kind: DirectoryKind,
): { recovery: "retry" | "connection"; message: string } | null {
  const reachable = source.effectiveState === "live" || source.effectiveState === "syncing";
  if (!reachable) return { recovery: "connection", message: source.error ?? "" };
  const error = source[kind].error;
  return error === null ? null : { recovery: "retry", message: error };
}

function hubLabel(source: SourceStatus, hubs: Map<string, HubSourceHealth>): string | undefined {
  return source.hubOrigin === null ? undefined : hubs.get(source.hubOrigin)?.label;
}
