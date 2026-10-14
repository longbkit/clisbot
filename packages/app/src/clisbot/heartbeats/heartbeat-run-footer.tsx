import { memo, useCallback, useMemo, useState, type ComponentProps } from "react";
import { Pressable, Text } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Clock } from "lucide-react-native";
import type { Theme } from "@/styles/theme";
import { STREAM_METADATA_FONT_SIZE } from "@/components/message";
import { useResponseFooterRevealed } from "@/components/response-footer";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { ScheduleDetailSheet } from "@/clisbot/schedules/schedule-detail-sheet";
import type { HeartbeatRun } from "@clisbot/protocol/schedule/heartbeat-notice";
import { useTranslation } from "react-i18next";
import { CompletedTurnFooterRow } from "@/agent-stream/turn-footer";
import type { TurnFooterHost } from "@/agent-stream/layout";
import type { StreamTurnTiming } from "@/timeline/turn-time";

export function useHeartbeatTurnFooterMetadata(input: {
  serverId: string;
  isTurnActive: boolean;
  turnTiming: StreamTurnTiming;
  host: TurnFooterHost | null;
}) {
  const run = input.isTurnActive
    ? input.turnTiming.runningHeartbeatRun
    : input.host?.timing?.heartbeatRun;
  return useMemo(
    () => (run ? <HeartbeatRunFooter serverId={input.serverId} run={run} /> : null),
    [input.serverId, run],
  );
}

/** Fusion metadata composed into the canonical session footer, with stable element props. */
export const HeartbeatCompletedTurnFooterRow = memo(function HeartbeatCompletedTurnFooterRow({
  serverId,
  ...props
}: ComponentProps<typeof CompletedTurnFooterRow> & { serverId: string }) {
  const run = props.timing?.heartbeatRun;
  const metadata = useMemo(
    () => (run ? <HeartbeatRunFooter serverId={serverId} run={run} /> : null),
    [run, serverId],
  );
  return <CompletedTurnFooterRow {...props} metadata={metadata} />;
});

const ThemedClock = withUnistyles(Clock);
const mutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/** This turn's immutable counter; inspect the saved ID, never the schedule's latest count. */
export const HeartbeatRunFooter = memo(function HeartbeatRunFooter({
  serverId,
  run,
  onFocusChange,
}: {
  serverId: string;
  run: HeartbeatRun;
  onFocusChange?: (focused: boolean) => void;
}) {
  const { t } = useTranslation();
  const revealed = useResponseFooterRevealed();
  const [focused, setFocused] = useState(false);
  const [open, setOpen] = useState(false);
  const counter = `${run.run}/${run.maxRuns === null ? "∞" : (run.maxRuns ?? "?")}`;
  const name = run.name?.trim();
  const focus = useCallback(() => {
    setFocused(true);
    onFocusChange?.(true);
  }, [onFocusChange]);
  const blur = useCallback(() => {
    setFocused(false);
    onFocusChange?.(false);
  }, [onFocusChange]);
  const openDetail = useCallback(() => setOpen(true), []);
  const closeDetail = useCallback(() => setOpen(false), []);
  return (
    <>
      <Tooltip enabledOnDesktop={Boolean(name)}>
        <TooltipTrigger asChild>
          <Pressable
            testID={`heartbeat-run-footer-${run.scheduleId}`}
            accessibilityRole="button"
            accessibilityLabel={t("heartbeats.runDetails", {
              name: name || t("heartbeats.untitledRun"),
              counter,
            })}
            style={[styles.trigger, !revealed && !focused && styles.hidden]}
            onFocus={focus}
            onBlur={blur}
            onPress={openDetail}
            hitSlop={8}
          >
            <ThemedClock size={12} uniProps={mutedMapping} />
            <Text style={styles.text}>{counter}</Text>
          </Pressable>
        </TooltipTrigger>
        {name ? (
          <TooltipContent>
            <Text>{name}</Text>
          </TooltipContent>
        ) : null}
      </Tooltip>
      {open ? (
        <ScheduleDetailSheet
          serverId={serverId}
          scheduleId={run.scheduleId}
          onClose={closeDetail}
        />
      ) : null}
    </>
  );
});

const styles = StyleSheet.create((theme) => ({
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    minHeight: 24,
    paddingHorizontal: theme.spacing[1],
  },
  hidden: { opacity: 0 },
  text: {
    color: theme.colors.foregroundMuted,
    fontSize: STREAM_METADATA_FONT_SIZE,
    fontVariant: ["tabular-nums"],
  },
}));
