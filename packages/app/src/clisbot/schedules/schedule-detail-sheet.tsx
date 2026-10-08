import equal from "fast-deep-equal";
import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import type { TFunction } from "i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Clock, Pause, Play, RotateCw, Trash2 } from "lucide-react-native";
import type { ScheduleRun, StoredSchedule } from "@clisbot/protocol/schedule/types";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { CadencePicker } from "./cadence-picker";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { StatusBadge, type StatusBadgeVariant } from "@/components/ui/status-badge";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useScheduleMutations } from "@/hooks/use-schedule-mutations";
import { useSessionStore } from "@/stores/session-store";
import { confirmDialog } from "@/utils/confirm-dialog";
import { toErrorMessage } from "@/utils/error-messages";
import { resolveScheduleTitle, validateCron } from "@/utils/schedule-format";
import { shortenPath } from "@/utils/shorten-path";
import { ScheduleRunsList } from "./schedule-runs-list";
import {
  draftFromSchedule,
  patchMissesMaxRuns,
  scheduleDraftPatch,
  type ScheduleDraft,
} from "./schedule-draft";
import { MaxRunsField } from "./max-runs-field";
import { ScheduleRepeatRow, SCHEDULE_SHEET_WIDTH } from "./schedule-repeat-row";
import { useRecentRuns, useScheduleDetail } from "./use-schedule-detail";
import { formatNextAt } from "@/clisbot/heartbeats/use-heartbeats";
import type { Theme } from "@/styles/theme";

const ThemedClock = withUnistyles(Clock);
const mutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

export interface ScheduleDetailSheetProps {
  serverId: string;
  scheduleId: string | null;
  onClose: () => void;
  /** The session the caller is showing, so "Runs in" can say "this session". */
  currentAgentId?: string | null;
  onOpenAgent?: (agentId: string) => void;
  /** `new-agent` schedules: open the full form for provider, project and isolation. */
  onEditSettings?: (schedule: StoredSchedule) => void;
}

/**
 * One schedule or heartbeat: what it sends and how often, edited in place, its latest runs, and
 * run now, pause and delete (docs/audits/2026-10-06-conversation-schedules.md). Heartbeat lists
 * and the Automations page open the same sheet.
 */
export function ScheduleDetailSheet(props: ScheduleDetailSheetProps): ReactElement {
  const { t } = useTranslation();
  const detail = useScheduleDetail(props.serverId, props.scheduleId);
  const schedule = detail.data;
  const { draft, setDraft, version } = useDraft(schedule);
  const patch = schedule && draft ? scheduleDraftPatch(schedule, draft) : null;
  const cadenceError =
    draft?.cadence.type === "cron" ? validateCron(draft.cadence.expression) : null;
  const submittable =
    cadenceError || (schedule && patchMissesMaxRuns(schedule, patch)) ? null : patch;
  const footer = useMemo(
    () =>
      schedule && draft ? (
        <ScheduleDetailActions {...props} schedule={schedule} patch={submittable} />
      ) : undefined,
    [draft, props, schedule, submittable],
  );
  const header = useMemo<SheetHeader>(
    () => ({
      title: schedule ? resolveScheduleTitle(schedule) : t("heartbeats.detail.loading"),
      actions: schedule ? <ScheduleStatusBadge schedule={schedule} /> : undefined,
    }),
    [schedule, t],
  );
  return (
    <AdaptiveModalSheet
      header={header}
      visible={props.scheduleId !== null}
      onClose={props.onClose}
      footer={footer}
      desktopMaxWidth={SCHEDULE_SHEET_WIDTH}
      testID="schedule-detail-sheet"
    >
      {schedule && draft ? (
        <ScheduleDetailBody
          key={version}
          {...props}
          schedule={schedule}
          draft={draft}
          setDraft={setDraft}
          cadenceError={cadenceError}
        />
      ) : (
        <Text style={styles.muted}>
          {detail.isError ? t("heartbeats.detail.loadFailed") : t("heartbeats.detail.loading")}
        </Text>
      )}
    </AdaptiveModalSheet>
  );
}

/**
 * The sheet's edits for one schedule. They survive a pause, a run or a refresh, so pressing Pause
 * never drops what is typed. Once the daemon holds the same values (a save landed) the edits are
 * clean again, so the next refresh shows the daemon's values and an old field is never resent.
 */
function useDraft(schedule: StoredSchedule | undefined) {
  const id = schedule?.id ?? "";
  const [state, setState] = useState<{ id: string; draft: ScheduleDraft } | null>(null);
  const stored = schedule ? draftFromSchedule(schedule) : null;
  const edited = state?.id === id && !equal(state.draft, stored) ? state.draft : null;
  const draft = edited ?? stored;
  const setDraft = useCallback(
    (update: (draft: ScheduleDraft) => ScheduleDraft) => {
      if (!schedule) return;
      setState((current) => ({
        id,
        draft: update(current?.id === id ? current.draft : draftFromSchedule(schedule)),
      }));
    },
    [id, schedule],
  );
  return { draft, setDraft, version: id };
}

/** Active, Paused or Ended, the same wherever a schedule is listed. */
export function ScheduleStatusBadge({
  schedule,
}: {
  schedule: Pick<StoredSchedule, "status">;
}): ReactElement {
  const { t } = useTranslation();
  const variants: Record<StoredSchedule["status"], [string, StatusBadgeVariant]> = {
    active: [t("heartbeats.detail.statusActive"), "success"],
    paused: [t("heartbeats.detail.statusPaused"), "warning"],
    completed: [t("heartbeats.detail.statusCompleted"), "muted"],
  };
  const [label, variant] = variants[schedule.status];
  return <StatusBadge label={label} variant={variant} />;
}

function ScheduleDetailBody(
  props: ScheduleDetailSheetProps & {
    schedule: StoredSchedule;
    draft: ScheduleDraft;
    setDraft: (update: (draft: ScheduleDraft) => ScheduleDraft) => void;
    cadenceError: string | null;
  },
): ReactElement {
  const { t } = useTranslation();
  const { schedule, draft, setDraft, cadenceError } = props;
  const size = useIsCompactFormFactor() ? "md" : "sm";
  const runs = useRecentRuns(schedule);
  const agentIdFor = useCallback(
    (run: ScheduleRun) =>
      run.agentId ?? (schedule.target.type === "agent" ? schedule.target.agentId : null),
    [schedule.target],
  );
  const setName = useCallback((name: string) => setDraft((d) => ({ ...d, name })), [setDraft]);
  const setPrompt = useCallback(
    (prompt: string) => setDraft((d) => ({ ...d, prompt })),
    [setDraft],
  );
  const setMaxRuns = useCallback(
    (maxRuns: string) => setDraft((d) => ({ ...d, maxRuns })),
    [setDraft],
  );
  const setCadence = useCallback(
    (cadence: ScheduleDraft["cadence"]) => setDraft((d) => ({ ...d, cadence })),
    [setDraft],
  );
  return (
    <View style={styles.body}>
      <RunsInLine {...props} />
      <Field label={t("heartbeats.detail.name")}>
        <FormTextInput
          size={size}
          initialValue={draft.name}
          onChangeText={setName}
          placeholder={t("heartbeats.detail.namePlaceholder")}
          testID="schedule-detail-name"
        />
      </Field>
      <Field label={t("heartbeats.detail.prompt")}>
        <FormTextInput
          size={size}
          initialValue={draft.prompt}
          onChangeText={setPrompt}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
          style={styles.multiline}
          testID="schedule-detail-prompt"
        />
      </Field>
      <ScheduleRepeatRow>
        <CadencePicker
          value={draft.cadence}
          onChange={setCadence}
          error={cadenceError ?? undefined}
          size={size}
        />
        <MaxRunsField
          cadence={draft.cadence}
          value={draft.maxRuns}
          onChange={setMaxRuns}
          size={size}
          testID="schedule-detail-max-runs"
        />
      </ScheduleRepeatRow>
      <Field label={t("heartbeats.detail.recentRuns")}>
        <ScheduleRunsList runs={runs} agentIdFor={agentIdFor} onOpenAgent={props.onOpenAgent} />
      </Field>
    </View>
  );
}

function RunsInLine({
  serverId,
  schedule,
  currentAgentId,
  onOpenAgent,
  onEditSettings,
}: ScheduleDetailSheetProps & { schedule: StoredSchedule }): ReactElement {
  const { t } = useTranslation();
  const agentId = schedule.target.type === "agent" ? schedule.target.agentId : null;
  const agentTitle = useSessionStore((state) =>
    agentId ? state.sessions[serverId]?.agents.get(agentId)?.title : undefined,
  );
  const handleOpen = useCallback(() => {
    if (agentId) onOpenAgent?.(agentId);
  }, [agentId, onOpenAgent]);
  const handleSettings = useCallback(() => onEditSettings?.(schedule), [onEditSettings, schedule]);
  const next = scheduleProgress(schedule, t);
  let where: ReactElement;
  if (agentId && agentId === currentAgentId) {
    where = <Text style={styles.metaStrong}>{t("heartbeats.detail.thisSession")}</Text>;
  } else if (agentId) {
    where = (
      <Pressable onPress={handleOpen} accessibilityRole="link" disabled={!onOpenAgent}>
        <Text style={styles.link}>
          {agentTitle?.trim() || t("heartbeats.detail.openSession")} ›
        </Text>
      </Pressable>
    );
  } else {
    const config = schedule.target.type === "new-agent" ? schedule.target.config : null;
    where = (
      <Text style={styles.metaStrong} numberOfLines={1}>
        {shortenPath(config?.cwd)} · {t("heartbeats.detail.newSessionEachRun")}
      </Text>
    );
  }
  return (
    <View style={styles.metaRow}>
      <ThemedClock size={14} uniProps={mutedMapping} />
      <Text style={styles.meta}>{t("heartbeats.detail.runsIn")}</Text>
      {where}
      {schedule.target.type === "agent" && schedule.target.chatId ? (
        <Text style={styles.meta}>· {t("heartbeats.detail.inChat")}</Text>
      ) : null}
      <View style={styles.spacer} />
      <Text style={styles.meta}>{next}</Text>
      {schedule.target.type === "new-agent" && onEditSettings ? (
        <Pressable
          onPress={handleSettings}
          accessibilityRole="button"
          testID="schedule-detail-more-settings"
        >
          <Text style={styles.link}>{t("heartbeats.detail.moreSettings")}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** When it runs next and how many runs are done, of the limit when there is one. */
function scheduleProgress(schedule: StoredSchedule, t: TFunction): string {
  const done = schedule.runs.filter((run) => run.status !== "running").length;
  const runs = schedule.maxRuns
    ? t("heartbeats.detail.runsDoneOf", { count: done, max: schedule.maxRuns })
    : t("heartbeats.detail.runsDone", { count: done });
  const next = formatNextAt(schedule.nextRunAt);
  if (schedule.status === "paused") return `${t("heartbeats.paused")} · ${runs}`;
  return next ? `${t("heartbeats.detail.nextRun", { when: next })} · ${runs}` : runs;
}

function ScheduleDetailActions({
  serverId,
  schedule,
  patch,
  onClose,
}: ScheduleDetailSheetProps & {
  schedule: StoredSchedule;
  patch: ReturnType<typeof scheduleDraftPatch>;
}): ReactElement {
  const { t } = useTranslation();
  const actions = useScheduleActions({ serverId, schedule, patch, onClose });
  const busy = actions.pending !== null;
  const ended = schedule.status === "completed";
  const paused = schedule.status === "paused";
  return (
    <View style={styles.actions}>
      {actions.error ? <Text style={styles.error}>{actions.error}</Text> : null}
      <View style={styles.actionRow}>
        <Button
          variant="ghost"
          leftIcon={Trash2}
          onPress={actions.remove}
          disabled={busy}
          testID="schedule-detail-delete"
        >
          {t("heartbeats.detail.delete")}
        </Button>
        <View style={styles.spacer} />
        {ended ? null : (
          <Button
            variant="outline"
            leftIcon={RotateCw}
            loading={actions.pending === "run"}
            disabled={busy}
            onPress={actions.runNow}
            testID="schedule-detail-run-now"
          >
            {t("heartbeats.detail.runNow")}
          </Button>
        )}
        {ended ? null : (
          <Button
            variant="outline"
            leftIcon={paused ? Play : Pause}
            loading={actions.pending === "toggle"}
            disabled={busy}
            onPress={actions.toggle}
            testID={paused ? "schedule-detail-resume" : "schedule-detail-pause"}
          >
            {paused ? t("heartbeats.resume") : t("heartbeats.pause")}
          </Button>
        )}
        <Button
          variant="default"
          loading={actions.pending === "save"}
          disabled={patch === null || busy}
          onPress={actions.save}
          testID="schedule-detail-save"
        >
          {t("heartbeats.detail.save")}
        </Button>
      </View>
    </View>
  );
}

/** Run now, pause or resume, save and delete, one at a time, with the last failure kept. */
function useScheduleActions({
  serverId,
  schedule,
  patch,
  onClose,
}: {
  serverId: string;
  schedule: StoredSchedule;
  patch: ReturnType<typeof scheduleDraftPatch>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const mutations = useScheduleMutations({ serverId });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const run = useCallback(async (key: string, action: () => Promise<void>) => {
    setPending(key);
    setError(null);
    try {
      await action();
      return true;
    } catch (cause) {
      setError(toErrorMessage(cause));
      return false;
    } finally {
      setPending(null);
    }
  }, []);
  const { id, status } = schedule;
  const runNow = useCallback(
    () => void run("run", () => mutations.runScheduleNow(id)),
    [id, mutations, run],
  );
  const toggle = useCallback(
    () =>
      void run("toggle", () =>
        status === "paused" ? mutations.resumeSchedule(id) : mutations.pauseSchedule(id),
      ),
    [id, mutations, run, status],
  );
  const save = useCallback(() => {
    if (patch) void run("save", () => mutations.updateSchedule({ id, ...patch }));
  }, [id, mutations, patch, run]);
  const remove = useCallback(() => {
    void (async () => {
      const confirmed = await confirmDialog({
        title: t("heartbeats.detail.deleteTitle", { name: resolveScheduleTitle(schedule) }),
        message: t("heartbeats.detail.deleteMessage"),
        confirmLabel: t("heartbeats.detail.delete"),
        destructive: true,
      });
      if (confirmed && (await run("delete", () => mutations.deleteSchedule(id)))) onClose();
    })();
  }, [id, mutations, onClose, run, schedule, t]);
  return { error, pending, runNow, toggle, save, remove };
}

const styles = StyleSheet.create((theme) => ({
  body: {
    gap: theme.spacing[4],
    paddingBottom: theme.spacing[2],
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  meta: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  metaStrong: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
    flexShrink: 1,
  },
  link: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
    textDecorationLine: "underline",
  },
  spacer: {
    flex: 1,
  },
  multiline: {
    minHeight: 88,
  },
  muted: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    paddingVertical: theme.spacing[4],
  },
  actions: {
    flex: 1,
    alignSelf: "stretch",
    gap: theme.spacing[2],
  },
  // The same footer as the schedule form: default-size buttons, the form's gap.
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: theme.spacing[3],
  },
  error: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.destructive,
  },
}));
