import { useCallback, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Clock, Pause, Pencil, Play, RotateCw, Trash2 } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { settingsStyles } from "@/styles/settings";
import { useToast } from "@/contexts/toast-context";
import { useScheduleMutations } from "@/hooks/use-schedule-mutations";
import type { Theme } from "@/styles/theme";
import { resolveScheduleTitle } from "@/utils/schedule-format";
import {
  ScheduleDetailSheet,
  ScheduleStatusBadge,
} from "@/clisbot/schedules/schedule-detail-sheet";
import { useCanManageSchedules } from "@/clisbot/schedules/use-schedule-detail";
import { confirmDialog } from "@/utils/confirm-dialog";
import { toErrorMessage } from "@/utils/error-messages";
import { useToggleHeartbeat } from "./heartbeats-menu";
import { heartbeatMeta, isEnded, useHostHeartbeats } from "./use-heartbeats";

const ThemedClock = withUnistyles(Clock);
const mutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/**
 * Shown in place of a tool call that created a heartbeat, and above a Chat reply whose turn made
 * one: the heartbeat as it is now, what it sends, and run, pause and edit right there
 * (docs/audits/2026-10-06-conversation-schedules.md). `fallback` while it is not loaded or gone.
 */
export function HeartbeatCard({
  serverId,
  scheduleId,
  fallback = null,
}: {
  serverId: string;
  scheduleId: string | null;
  fallback?: ReactElement | null;
}): ReactElement | null {
  const { t } = useTranslation();
  const { heartbeats } = useHostHeartbeats(serverId);
  const heartbeat = heartbeats.find((entry) => entry.id === scheduleId);
  const { runScheduleNow, deleteSchedule } = useScheduleMutations({ serverId });
  // Viewers without `schedule.manage` see the card, not buttons that would only fail.
  const canManage = useCanManageSchedules(serverId);
  const toast = useToast();
  const [detailId, setDetailId] = useState<string | null>(null);
  const openDetail = useCallback(() => setDetailId(scheduleId), [scheduleId]);
  const closeDetail = useCallback(() => setDetailId(null), []);
  const paused = heartbeat?.status === "paused";
  const runNow = useCallback(() => {
    if (scheduleId)
      runScheduleNow(scheduleId).catch((cause: unknown) => toast.error(toErrorMessage(cause)));
  }, [runScheduleNow, scheduleId, toast]);
  const toggle = useToggleHeartbeat(serverId, scheduleId, paused);
  const title = heartbeat ? resolveScheduleTitle(heartbeat) : "";
  const remove = useCallback(() => {
    if (!scheduleId) return;
    void (async () => {
      const confirmed = await confirmDialog({
        title: t("heartbeats.detail.deleteTitle", { name: title }),
        message: t("heartbeats.detail.deleteMessage"),
        confirmLabel: t("heartbeats.detail.delete"),
        destructive: true,
      });
      if (!confirmed) return;
      await deleteSchedule(scheduleId).catch((cause: unknown) =>
        toast.error(toErrorMessage(cause)),
      );
    })();
  }, [deleteSchedule, scheduleId, t, title, toast]);
  if (!scheduleId || !heartbeat) return fallback;
  // The settings card primitive (docs/design.md): white, `border`, `shadow.card` in Light.
  return (
    <View style={styles.frame} testID={`heartbeat-card-${heartbeat.id}`}>
      <View style={settingsStyles.card}>
        <View style={styles.body}>
          <View style={styles.top}>
            <ThemedClock size={14} uniProps={mutedMapping} />
            <Text style={styles.topText}>{t("heartbeats.created")}</Text>
            <View style={styles.spacer} />
            <ScheduleStatusBadge schedule={heartbeat} />
          </View>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.meta}>{heartbeatMeta(heartbeat, t, { withStatus: false })}</Text>
          <View style={styles.prompt}>
            <Text style={styles.promptText} numberOfLines={2}>
              {heartbeat.prompt}
            </Text>
          </View>
        </View>
        {canManage ? (
          <View style={styles.actions}>
            {isEnded(heartbeat) ? null : (
              <>
                <Button variant="ghost" size="sm" leftIcon={RotateCw} onPress={runNow}>
                  {t("heartbeats.detail.runNow")}
                </Button>
                <Button variant="ghost" size="sm" leftIcon={paused ? Play : Pause} onPress={toggle}>
                  {paused ? t("heartbeats.resume") : t("heartbeats.pause")}
                </Button>
              </>
            )}
            <Button variant="ghost" size="sm" leftIcon={Pencil} onPress={openDetail}>
              {t("heartbeats.edit")}
            </Button>
            <View style={styles.spacer} />
            <Button variant="ghost" size="sm" leftIcon={Trash2} onPress={remove}>
              {t("heartbeats.detail.delete")}
            </Button>
          </View>
        ) : null}
      </View>
      {detailId ? (
        <ScheduleDetailSheet serverId={serverId} scheduleId={detailId} onClose={closeDetail} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  // Room above and below, so the card stands apart from the reply text around it.
  frame: {
    width: "100%",
    maxWidth: 560,
    marginTop: theme.spacing[2],
    marginBottom: theme.spacing[4],
  },
  body: {
    paddingHorizontal: theme.spacing[4],
    paddingTop: theme.spacing[3],
    paddingBottom: theme.spacing[4],
    gap: theme.spacing[2],
  },
  top: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  topText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  title: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
  },
  meta: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  prompt: {
    marginTop: theme.spacing[1],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
  },
  promptText: {
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm * 1.5,
    color: theme.colors.foreground,
  },
  spacer: {
    flex: 1,
  },
  // A divider, lighter than the card's outline (docs/design.md, rows inside a card).
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    borderTopWidth: 1,
    borderTopColor: theme.colors.borderSubtle,
  },
}));
