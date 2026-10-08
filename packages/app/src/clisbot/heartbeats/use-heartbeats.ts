import { useMemo } from "react";
import type { TFunction } from "i18next";
import { useSchedules, type AggregatedSchedule } from "@/hooks/use-schedules";
import type { ScheduleCadence } from "@clisbot/protocol/schedule/types";
import { formatCadence } from "@/utils/schedule-format";
import { getDeviceTimeZone } from "@/utils/device-timezone";
import { choiceFromCron } from "@/clisbot/schedules/cadence-choice";
import { i18n } from "@/i18n/i18next";

/**
 * Heartbeats (target `agent`) on one host, from the shared schedules query: running and paused
 * first, then ended ones, which stay listed so a finished heartbeat can still be opened.
 */
export function useHostHeartbeats(serverId: string | null) {
  const schedules = useSchedules();
  const { loadState } = schedules;
  const heartbeats = useMemo<AggregatedSchedule[]>(
    () =>
      loadState.status === "loaded"
        ? loadState.data
            .filter(
              (schedule) => schedule.serverId === serverId && schedule.target.type === "agent",
            )
            .sort((a, b) => Number(isEnded(a)) - Number(isEnded(b)))
        : [],
    [loadState, serverId],
  );
  return { heartbeats, refetch: schedules.refetch };
}

export function isEnded(schedule: { status: string }): boolean {
  return schedule.status === "completed";
}

export function heartbeatsOf(
  heartbeats: readonly AggregatedSchedule[],
  agentIds: readonly string[],
): AggregatedSchedule[] {
  return heartbeats.filter(
    (schedule) => schedule.target.type === "agent" && agentIds.includes(schedule.target.agentId),
  );
}

/**
 * One line under a schedule's name, short enough for a menu row: how often, how far along
 * ("3 of 10 runs"), and when it runs next, or that it is paused or has ended. Beside a status
 * badge, pass `withStatus: false` so the line does not say it again.
 */
export function heartbeatMeta(
  schedule: AggregatedSchedule,
  t: TFunction,
  { withStatus = true }: { withStatus?: boolean } = {},
): string {
  const parts = [describeCadence(schedule.cadence, t)];
  const progress = runProgress(schedule, t);
  if (progress) parts.push(progress);
  const next = formatNextAt(schedule.nextRunAt);
  if (schedule.status === "active" && next) parts.push(t("heartbeats.next", { when: next }));
  else if (withStatus && isEnded(schedule)) parts.push(t("heartbeats.detail.statusCompleted"));
  else if (withStatus && schedule.status === "paused") parts.push(t("heartbeats.paused"));
  return parts.join(" · ");
}

/** "3 of 10 runs", "3 runs", or nothing before the first run of an unlimited schedule. */
function runProgress(
  schedule: { runCount?: number; maxRuns: number | null },
  t: TFunction,
): string | null {
  const count = schedule.runCount;
  // A daemon before `runCount` says only the limit.
  if (count === undefined) {
    return schedule.maxRuns ? t("heartbeats.maxRuns", { count: schedule.maxRuns }) : null;
  }
  if (schedule.maxRuns) return t("heartbeats.detail.runsDoneOf", { count, max: schedule.maxRuns });
  return count > 0 ? t("heartbeats.detail.runsDone", { count }) : null;
}

/**
 * The cadence in words: "Every 2 minutes" for steps the schedule format leaves as cron, and the
 * device's own timezone left out, since the time already reads in it.
 */
export function describeCadence(cadence: ScheduleCadence, t: TFunction): string {
  if (cadence.type === "cron") {
    const choice = choiceFromCron(cadence.expression);
    if (choice.mode === "every") {
      const count = Number(choice.amount);
      return choice.unit === "minutes"
        ? t("heartbeats.cadence.everyMinutes", { count })
        : t("heartbeats.cadence.everyHours", { count });
    }
  }
  const text = formatCadence(cadence);
  const zone = ` ${getDeviceTimeZone()}`;
  return text.endsWith(zone) ? text.slice(0, -zone.length) : text;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * When a heartbeat runs next, as a clock reads it: `15:00` today, `Thu 09:00` this week, else the
 * date, with the year when it is not this one. A heartbeat is checked against the day, so a time
 * says more than "in 3h". A time already past (the daemon has not run it yet) shows its date, so
 * yesterday never reads as today. Formats in the app's language.
 */
export function formatNextAt(
  iso: string | null,
  now: Date = new Date(),
  locale: string = i18n.language,
): string {
  if (!iso) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const time = at.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  const days = Math.round((startOfDay(at) - startOfDay(now)) / DAY_MS);
  if (days === 0) return time;
  if (days > 0 && days < 7) return `${at.toLocaleDateString(locale, { weekday: "short" })} ${time}`;
  const year = at.getFullYear() === now.getFullYear() ? {} : { year: "numeric" as const };
  return `${at.toLocaleDateString(locale, { month: "short", day: "numeric", ...year })} ${time}`;
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}
