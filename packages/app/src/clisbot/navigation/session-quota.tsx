import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { StyleSheet } from "react-native-unistyles";
import { useUsageDisplay } from "@/usage/display";
import { formatPct, formatResetDuration } from "@/usage/format";
import { displayPercent } from "@/usage/model";
import type { UsageDisplayAs } from "@/usage/preferences";
import { useAgentUsage } from "@/usage/queries";
import type { UsageReportEntry, UsageTone, UsageWindow } from "@/usage/types";
import { UsageMeter } from "@/usage/meter";
import { windowTone } from "@/usage/tone";
import { useRelativeTimeTick } from "@/usage/use-relative-time-tick";
import type { OpenedSession } from "./opened-session";

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
 * A session's quota in two lines (Owner, 2026-10-26): the hour window (the 5-hour session limit)
 * and the weekly one, each as its percent and the time to its reset in one unit. Taken from the
 * first account report that has either; scoped limits (one model's weekly) are left out.
 */
export function sessionQuotaLines(
  reports: readonly UsageReportEntry[],
  displayAs: UsageDisplayAs,
  now: number,
  t: TFunction,
): QuotaLine[] {
  for (const entry of reports) {
    if (entry.report.status !== "available") continue;
    const windows = entry.report.windows;
    const lines = [
      line(
        "hour",
        windows.find((window) => HOUR_WINDOWS.has(window.id)),
      ),
      line(
        "week",
        windows.find((window) => window.id === "weekly"),
      ),
    ].flatMap((value) => (value ? [value] : []));
    if (lines.length) return lines;
  }
  return [];

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
  const view = useAgentUsage(session.serverId, session.agentId);
  const reports = view.kind === "ready" ? view.reports : NO_REPORTS;
  const { display } = useUsageDisplay(reports);
  const now = useRelativeTimeTick({ enabled: true });
  const lines = sessionQuotaLines(reports, display.displayAs, now, t);
  if (!lines.length) return null;
  const used = display.displayAs === "used";
  const label = lines
    .map((entry) =>
      t(`navigation.quota.${entry.kind}`, {
        percent: entry.percent,
        state: t(used ? "navigation.quota.used" : "navigation.quota.left"),
        reset: entry.reset ?? "",
      }),
    )
    .join(", ");
  return (
    <View
      style={layout === "rail" ? styles.rail : styles.row}
      accessibilityLabel={label}
      testID="session-quota"
    >
      {lines.map((entry) => (
        <View key={entry.kind} style={styles.entry}>
          <Text style={styles.line} numberOfLines={1} testID={`session-quota-${entry.kind}`}>
            <Text style={styles.percent}>{entry.percent}</Text>
            {entry.reset ? <Text style={styles.reset}>{` ${entry.reset}`}</Text> : null}
          </Text>
          <UsageMeter percent={entry.value} tone={entry.tone} style={styles.meter} />
        </View>
      ))}
    </View>
  );
}

const NO_REPORTS: readonly UsageReportEntry[] = [];

// Two dense lines: the percent carries the weight, the reset recedes, and a 2px meter in the
// window's tone says how full it is at a glance.
const QUOTA_LINE_HEIGHT = 14;
const METER_WIDTH = 40;

const styles = StyleSheet.create((theme) => ({
  rail: { alignItems: "center", gap: theme.spacing[1], marginTop: theme.spacing[0.5] },
  row: { alignItems: "flex-end", gap: theme.spacing[1] },
  entry: { alignItems: "stretch", gap: 2, width: METER_WIDTH + theme.spacing[2] },
  line: {
    textAlign: "center",
    fontSize: theme.fontSize.sm,
    lineHeight: QUOTA_LINE_HEIGHT,
    fontVariant: ["tabular-nums"],
  },
  percent: { color: theme.colors.foreground, fontWeight: theme.fontWeight.medium },
  reset: { color: theme.colors.foregroundMuted },
  meter: { height: 2, borderRadius: 1, alignSelf: "center", width: METER_WIDTH },
}));
