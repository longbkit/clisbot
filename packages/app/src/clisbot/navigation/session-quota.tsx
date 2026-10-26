import { useEffect, useRef } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { StyleSheet } from "react-native-unistyles";
import { useUsageDisplay } from "@/usage/display";
import { formatPct, formatResetDuration } from "@/usage/format";
import { displayPercent, usedPercent } from "@/usage/model";
import type { UsageDisplayAs } from "@/usage/preferences";
import { useLiveAgentUsage } from "@/usage/live-agent-usage";
import { entryGoodAt, isUsageStale } from "@/usage/refresh-policy";
import type { UsageReportEntry, UsageTone, UsageWindow } from "@/usage/types";
import { UsageMeter } from "@/usage/meter";
import { windowTone } from "@/usage/tone";
import { useRelativeTimeTick } from "@/usage/use-relative-time-tick";
import type { OpenedSession } from "./opened-session";
import { RAIL_MICRO_TEXT } from "./rail-text";

export interface QuotaLine {
  kind: "hour" | "week";
  percent: string;
  /** The shown percent as a number, for the meter. */
  value: number;
  tone: UsageTone;
  reset: string | null;
}

const HOUR_WINDOWS = new Set(["five_hour", "session"]);

/**
 * The numbers a session's quota shows: the windows of the first account report that has an hour
 * or a weekly one (scoped limits, one model's weekly, are left out), and when they were read. A
 * report whose latest read failed still counts through the daemon's last good one, with
 * `current` false.
 */
export interface QuotaSource {
  windows: UsageWindow[];
  goodAt: number | null;
  current: boolean;
}

export function quotaSource(reports: readonly UsageReportEntry[]): QuotaSource | null {
  for (const entry of reports) {
    const content =
      entry.report.status === "available" ? entry.report : entry.lastSuccessful?.report;
    const windows = content?.windows.filter(isQuotaWindow) ?? [];
    if (windows.length)
      return {
        windows,
        goodAt: entryGoodAt(entry),
        current: entry.report.status === "available",
      };
  }
  return null;
}

function isQuotaWindow(window: UsageWindow): boolean {
  return (HOUR_WINDOWS.has(window.id) || window.id === "weekly") && usedPercent(window) != null;
}

/**
 * A session's quota in two lines (Owner, 2026-10-26): the hour window (the 5-hour session limit)
 * and the weekly one, each as its percent and the time to its reset in one unit.
 */
export function quotaLines(
  windows: readonly UsageWindow[],
  displayAs: UsageDisplayAs,
  now: number,
  t: TFunction,
): QuotaLine[] {
  return [
    line(
      "hour",
      windows.find((window) => HOUR_WINDOWS.has(window.id)),
    ),
    line(
      "week",
      windows.find((window) => window.id === "weekly"),
    ),
  ].flatMap((value) => (value ? [value] : []));

  function line(kind: QuotaLine["kind"], window: UsageWindow | undefined): QuotaLine | null {
    const value = window ? displayPercent(window, displayAs) : null;
    if (!window || value == null) return null;
    return {
      kind,
      percent: formatPct(value),
      value,
      tone: windowTone(window),
      reset: formatResetDuration(window.resetsAt, now, t),
    };
  }
}

/** The lines of the first report that has any. */
export function sessionQuotaLines(
  reports: readonly UsageReportEntry[],
  displayAs: UsageDisplayAs,
  now: number,
  t: TFunction,
): QuotaLine[] {
  const source = quotaSource(reports);
  return source ? quotaLines(source.windows, displayAs, now, t) : [];
}

/**
 * The last numbers shown, for a read that fails without the daemon's own last good one (an older
 * daemon): the quota stays up, marked stale, instead of vanishing.
 */
function useRetainedSource(found: QuotaSource | null): QuotaSource | null {
  const last = useRef<QuotaSource | null>(null);
  useEffect(() => {
    if (found) last.current = found;
  });
  return found ?? (last.current ? { ...last.current, current: false } : null);
}

/**
 * The quota of one session's account, as two short lines; nothing while it loads or when the
 * Host cannot report usage for it.
 */
export function SessionQuota({
  session,
  layout,
}: {
  session: OpenedSession;
  /** `rail`: centred under the rail icon; `row`: right-aligned in a More row. */
  layout: "rail" | "row";
}) {
  const { t } = useTranslation();
  const live = useLiveAgentUsage(session.serverId, session.agentId);
  const reports = live.canReport ? live.reports : NO_REPORTS;
  const { display } = useUsageDisplay(reports);
  const now = useRelativeTimeTick({ enabled: true });
  const source = useRetainedSource(quotaSource(reports));
  const lines =
    live.canReport && source ? quotaLines(source.windows, display.displayAs, now, t) : [];
  if (!lines.length || !source) return null;
  const stale = isUsageStale(
    { goodAt: source.goodAt, failing: live.requestFailed || !source.current },
    now,
  );
  const used = display.displayAs === "used";
  const label = lines
    .map((entry) =>
      t(`navigation.quota.${entry.kind}`, {
        percent: entry.percent,
        state: t(used ? "navigation.quota.used" : "navigation.quota.left"),
        reset: entry.reset ?? "",
      }),
    )
    .concat(stale ? [t("navigation.quota.stale")] : [])
    .join(", ");
  return (
    <View
      style={layout === "rail" ? styles.rail : styles.row}
      accessibilityLabel={label}
      testID="session-quota"
    >
      {lines.map((entry) => (
        <View
          key={entry.kind}
          style={[layout === "rail" ? styles.entryRail : styles.entry, stale && styles.stale]}
        >
          <Text
            style={layout === "rail" ? styles.lineRail : styles.line}
            numberOfLines={1}
            testID={`session-quota-${entry.kind}`}
          >
            <Text style={styles.percent}>{`${stale ? "~" : ""}${entry.percent}`}</Text>
            {entry.reset ? <Text style={styles.reset}>{` ${entry.reset}`}</Text> : null}
          </Text>
          <UsageMeter
            percent={entry.value}
            tone={entry.tone}
            style={layout === "rail" ? styles.meterRail : styles.meter}
          />
        </View>
      ))}
    </View>
  );
}

const NO_REPORTS: readonly UsageReportEntry[] = [];

// Two dense lines: the percent carries the weight, the reset recedes, and a thin meter in the
// window's tone says how full it is at a glance. On the rail they use its micro text
// (`RAIL_MICRO_TEXT`), smaller than the item label above them.
const QUOTA_LINE_HEIGHT = 14;
const METER_WIDTH = 40;
const RAIL_METER_WIDTH = 30;

const styles = StyleSheet.create((theme) => ({
  rail: { alignItems: "center", gap: 3, marginTop: 2 },
  row: { alignItems: "flex-end", gap: theme.spacing[1] },
  entry: { alignItems: "stretch", gap: 2, minWidth: METER_WIDTH + theme.spacing[2] },
  entryRail: { alignItems: "center", gap: 1 },
  lineRail: { textAlign: "center", ...RAIL_MICRO_TEXT, fontVariant: ["tabular-nums"] },
  meterRail: { height: 2, borderRadius: 1, width: RAIL_METER_WIDTH },
  line: {
    textAlign: "center",
    fontSize: theme.fontSize.sm,
    lineHeight: QUOTA_LINE_HEIGHT,
    fontVariant: ["tabular-nums"],
  },
  // Numbers older than a cache lifetime whose refresh failed: the same lines, receded, with a
  // "~" before the percent: dim alone reads as a muted state, a dotted underline as a link.
  stale: { opacity: theme.opacity[50] },
  percent: { color: theme.colors.foreground, fontWeight: theme.fontWeight.medium },
  reset: { color: theme.colors.foregroundMuted },
  meter: { height: 2, borderRadius: 1, alignSelf: "center", width: METER_WIDTH },
}));
