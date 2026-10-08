import { useCallback, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { CheckCircle2, CircleDashed, XCircle } from "lucide-react-native";
import type { ScheduleRun } from "@clisbot/protocol/schedule/types";
import type { Theme } from "@/styles/theme";

const ThemedCheck = withUnistyles(CheckCircle2);
const ThemedFailed = withUnistyles(XCircle);
const ThemedRunning = withUnistyles(CircleDashed);
const successMapping = (theme: Theme) => ({ color: theme.colors.statusSuccess });
const dangerMapping = (theme: Theme) => ({ color: theme.colors.statusDanger });
const mutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

function RunStatusIcon({ status }: { status: ScheduleRun["status"] }): ReactElement {
  if (status === "succeeded") return <ThemedCheck size={14} uniProps={successMapping} />;
  if (status === "failed") return <ThemedFailed size={14} uniProps={dangerMapping} />;
  return <ThemedRunning size={14} uniProps={mutedMapping} />;
}

function formatRunTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const sameDay = date.toDateString() === new Date().toDateString();
  return sameDay
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });
}

function runSummary(run: ScheduleRun, runningLabel: string): string {
  if (run.status === "running") return runningLabel;
  const text = run.status === "failed" ? run.error : run.output;
  return (
    text
      ?.split("\n")
      .find((line) => line.trim().length > 0)
      ?.trim() ?? ""
  );
}

/** A schedule's latest runs: outcome, when, the first line of what it said, and a way to it. */
export function ScheduleRunsList({
  runs,
  agentIdFor,
  onOpenAgent,
}: {
  runs: readonly ScheduleRun[];
  /** The session a run's output lives in. */
  agentIdFor: (run: ScheduleRun) => string | null;
  onOpenAgent?: (agentId: string) => void;
}): ReactElement {
  const { t } = useTranslation();
  if (runs.length === 0) {
    return <Text style={styles.empty}>{t("heartbeats.detail.noRuns")}</Text>;
  }
  return (
    <View>
      {runs.map((run) => (
        <ScheduleRunRow
          key={run.id}
          run={run}
          agentId={agentIdFor(run)}
          onOpenAgent={onOpenAgent}
          runningLabel={t("heartbeats.detail.runRunning")}
          viewLabel={t("heartbeats.detail.view")}
        />
      ))}
    </View>
  );
}

function ScheduleRunRow({
  run,
  agentId,
  onOpenAgent,
  runningLabel,
  viewLabel,
}: {
  run: ScheduleRun;
  agentId: string | null;
  onOpenAgent?: (agentId: string) => void;
  runningLabel: string;
  viewLabel: string;
}): ReactElement {
  const handleView = useCallback(() => {
    if (agentId) onOpenAgent?.(agentId);
  }, [agentId, onOpenAgent]);
  return (
    <View style={styles.row} testID={`schedule-run-${run.id}`}>
      <RunStatusIcon status={run.status} />
      <Text style={styles.time}>{formatRunTime(run.startedAt)}</Text>
      <Text style={styles.summary} numberOfLines={1}>
        {runSummary(run, runningLabel)}
      </Text>
      {agentId && onOpenAgent ? (
        <Pressable onPress={handleView} accessibilityRole="link" hitSlop={6}>
          <Text style={styles.view}>{viewLabel} ›</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  time: {
    width: 84,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  summary: {
    flex: 1,
    minWidth: 0,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  view: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  empty: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    paddingVertical: theme.spacing[2],
  },
}));
