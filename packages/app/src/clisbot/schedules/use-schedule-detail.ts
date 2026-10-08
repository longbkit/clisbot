import { useMemo } from "react";
import type { StoredSchedule } from "@clisbot/protocol/schedule/types";
import { useFetchQuery } from "@/data/query";
import { i18n } from "@/i18n/i18next";
import { schedulesQueryBaseKey } from "@/schedules/aggregated-schedules";
import { useHosts } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";

/**
 * One schedule with its run history, for the detail sheet. Keyed under the shared schedules key,
 * so every schedule mutation (which invalidates that key) refreshes it too.
 */
export function useScheduleDetail(serverId: string, scheduleId: string | null) {
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  return useFetchQuery({
    queryKey: [...schedulesQueryBaseKey, "detail", serverId, scheduleId ?? ""],
    enabled: client !== null && scheduleId !== null,
    dataShape: "value",
    staleTimeMs: 2_000,
    queryFn: async (): Promise<StoredSchedule> => {
      if (!client || !scheduleId) {
        throw new Error(i18n.t("common.errors.daemonClientUnavailable"));
      }
      const payload = await client.scheduleInspect({ id: scheduleId });
      if (payload.error || !payload.schedule) {
        throw new Error(payload.error ?? "Schedule not found");
      }
      return payload.schedule;
    },
  });
}

/**
 * Whether a session with these permissions may manage schedules. A daemon that reports none is
 * older than permissions and lets every client in, as before.
 */
export function canManageSchedules(permissions: readonly string[] | undefined): boolean {
  return permissions === undefined || permissions.includes("automation.manage");
}

/** Whether the session may manage schedules on this host (`schedule.manage` somewhere on it). */
export function useCanManageSchedules(serverId: string | null): boolean {
  const permissions = useSessionStore((state) =>
    serverId ? state.sessions[serverId]?.serverInfo?.permissions : undefined,
  );
  return canManageSchedules(permissions);
}

/** Whether any host lets this session create a schedule, so New schedule is worth offering. */
export function useCanCreateSchedules(): boolean {
  const hosts = useHosts();
  return useSessionStore((state) =>
    hosts.some((host) =>
      canManageSchedules(state.sessions[host.serverId]?.serverInfo?.permissions),
    ),
  );
}

export function useRecentRuns(schedule: StoredSchedule | undefined, limit = 5) {
  return useMemo(
    () =>
      [...(schedule?.runs ?? [])]
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        .slice(0, limit),
    [limit, schedule?.runs],
  );
}
