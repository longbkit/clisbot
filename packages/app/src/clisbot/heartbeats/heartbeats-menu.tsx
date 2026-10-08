import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text } from "react-native";
import { router } from "expo-router";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ChevronRight, Clock, Pause, Play, Plus } from "lucide-react-native";
import type { MenuTriggerState } from "@/components/ui/menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuItemAction,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  extraMutedIconColorMapping,
  iconButtonChromeGlyphSize,
  iconButtonChromeStyle,
} from "@/components/ui/icon-button-chrome";
import { ScheduleFormSheet } from "@/components/schedules/schedule-form-sheet";
import { useToast } from "@/contexts/toast-context";
import { useScheduleMutations } from "@/hooks/use-schedule-mutations";
import type { AggregatedSchedule } from "@/hooks/use-schedules";
import type { Theme } from "@/styles/theme";
import { toErrorMessage } from "@/utils/error-messages";
import { resolveScheduleTitle } from "@/utils/schedule-format";
import { ScheduleDetailSheet } from "@/clisbot/schedules/schedule-detail-sheet";
import { useCanManageSchedules } from "@/clisbot/schedules/use-schedule-detail";
import { heartbeatMeta, heartbeatsOf, isEnded, useHostHeartbeats } from "./use-heartbeats";

const ThemedClock = withUnistyles(Clock);
const ThemedIcon = {
  clock: withUnistyles(Clock),
  chevron: withUnistyles(ChevronRight),
  pause: withUnistyles(Pause),
  play: withUnistyles(Play),
  plus: withUnistyles(Plus),
};
const mutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const ALL_ICON = <ThemedIcon.clock size={16} uniProps={mutedMapping} />;
const OPEN_ICON = <ThemedIcon.chevron size={16} uniProps={mutedMapping} />;
const NEW_ICON = <ThemedIcon.plus size={16} uniProps={mutedMapping} />;
const PAUSE_ICON = <ThemedIcon.pause size={14} uniProps={mutedMapping} />;
const RESUME_ICON = <ThemedIcon.play size={14} uniProps={mutedMapping} />;

/**
 * A group of sessions in the Heartbeats menu. Current groups are what the screen shows (the
 * selected tab, the Chat's Bots) and lead the menu; the rest are other sessions of the same
 * workspace, each reached through its own row.
 */
export interface HeartbeatSection {
  key: string;
  title: string;
  agentIds: readonly string[];
  current: boolean;
  /** Creating from this group presets the heartbeat to this session. */
  createAgentId?: string | null;
  /** Jump to the session (other sessions only). */
  onOpen?: () => void;
  /** Shown before an other session's name, e.g. its provider. */
  icon?: ReactElement;
}

/**
 * The ⏱ button after a header's ⋯: the heartbeats of what the screen shows, a quick pause, and
 * the way to make one (docs/audits/2026-10-06-conversation-schedules.md). Always shown, so the
 * empty case is one press from creating the first heartbeat.
 */
export function HeartbeatsMenu({
  serverId,
  sections,
  emptyHint,
  onOpenAgent,
  testID = "heartbeats-menu",
}: {
  serverId: string;
  sections: readonly HeartbeatSection[];
  emptyHint: string;
  onOpenAgent?: (agentId: string) => void;
  testID?: string;
}): ReactElement | null {
  const { t } = useTranslation();
  const canManage = useCanManageSchedules(serverId);
  const { heartbeats, refetch } = useHostHeartbeats(serverId);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [createFor, setCreateFor] = useState<string | null>(null);
  const current = sections.filter((section) => section.current);
  // The count is what still runs; ended heartbeats stay listed but are not counted.
  const count = heartbeatsOf(
    heartbeats,
    current.flatMap((section) => section.agentIds),
  ).filter((heartbeat) => !isEnded(heartbeat)).length;
  const handleOpenChange = useCallback((open: boolean) => open && refetch(), [refetch]);
  const closeDetail = useCallback(() => setDetailId(null), []);
  const closeCreate = useCallback(() => setCreateFor(null), []);
  const triggerStyle = useCallback(
    (state: MenuTriggerState) =>
      iconButtonChromeStyle({
        size: "large",
        state,
        style: count > 0 ? styles.withCount : undefined,
      }),
    [count],
  );
  if (!canManage) return null;
  return (
    <>
      <DropdownMenu onOpenChange={handleOpenChange}>
        <DropdownMenuTrigger
          testID={testID}
          accessibilityRole="button"
          accessibilityLabel={t("heartbeats.button")}
          style={triggerStyle}
        >
          <ThemedClock
            size={iconButtonChromeGlyphSize("large")}
            uniProps={extraMutedIconColorMapping}
          />
          {count > 0 ? <Text style={styles.count}>{count}</Text> : null}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" width={300} testID={`${testID}-content`}>
          <HeartbeatsMenuItems
            serverId={serverId}
            sections={sections}
            heartbeats={heartbeats}
            emptyHint={emptyHint}
            onOpenDetail={setDetailId}
            onCreate={setCreateFor}
          />
        </DropdownMenuContent>
      </DropdownMenu>
      <ScheduleDetailSheet
        serverId={serverId}
        scheduleId={detailId}
        onClose={closeDetail}
        currentAgentId={current.length === 1 ? (current[0]?.agentIds[0] ?? null) : null}
        onOpenAgent={onOpenAgent}
      />
      <ScheduleFormSheet
        serverId={serverId}
        visible={createFor !== null}
        onClose={closeCreate}
        mode="create"
        presetAgentId={createFor ?? undefined}
      />
    </>
  );
}

function HeartbeatsMenuItems({
  serverId,
  sections,
  heartbeats,
  emptyHint,
  onOpenDetail,
  onCreate,
}: {
  serverId: string;
  sections: readonly HeartbeatSection[];
  heartbeats: readonly AggregatedSchedule[];
  emptyHint: string;
  onOpenDetail: (scheduleId: string) => void;
  onCreate: (agentId: string) => void;
}): ReactElement {
  const { t } = useTranslation();
  const current = sections.filter((section) => section.current);
  const others = sections.filter(
    (section) => !section.current && heartbeatsOf(heartbeats, section.agentIds).length > 0,
  );
  const several = current.length > 1;
  const openAll = useCallback(() => router.push("/schedules"), []);
  return (
    <>
      {current.map((section) => (
        <CurrentSectionItems
          key={section.key}
          serverId={serverId}
          section={section}
          heartbeats={heartbeatsOf(heartbeats, section.agentIds)}
          emptyHint={several ? null : emptyHint}
          createLabel={
            several
              ? t("heartbeats.newHeartbeatFor", { name: section.title })
              : t("heartbeats.newHeartbeat")
          }
          onOpenDetail={onOpenDetail}
          onCreate={onCreate}
        />
      ))}
      {others.length > 0 ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>{t("heartbeats.otherSessions")}</DropdownMenuLabel>
          {others.map((section) => (
            <OtherSectionItems
              key={section.key}
              serverId={serverId}
              section={section}
              heartbeats={heartbeatsOf(heartbeats, section.agentIds)}
              onOpenDetail={onOpenDetail}
            />
          ))}
        </>
      ) : null}
      <DropdownMenuSeparator />
      <DropdownMenuItem leading={ALL_ICON} onSelect={openAll} testID="heartbeats-menu-all">
        {t("heartbeats.allSchedules")}
      </DropdownMenuItem>
    </>
  );
}

function CurrentSectionItems({
  serverId,
  section,
  heartbeats,
  emptyHint,
  createLabel,
  onOpenDetail,
  onCreate,
}: {
  serverId: string;
  section: HeartbeatSection;
  heartbeats: readonly AggregatedSchedule[];
  emptyHint: string | null;
  createLabel: string;
  onOpenDetail: (scheduleId: string) => void;
  onCreate: (agentId: string) => void;
}): ReactElement {
  const { t } = useTranslation();
  const createAgentId = section.createAgentId ?? null;
  const handleCreate = useCallback(() => {
    if (createAgentId) onCreate(createAgentId);
  }, [createAgentId, onCreate]);
  return (
    <>
      <DropdownMenuLabel numberOfLines={1}>{section.title}</DropdownMenuLabel>
      {heartbeats.map((heartbeat) => (
        <HeartbeatRow
          key={heartbeat.id}
          serverId={serverId}
          heartbeat={heartbeat}
          onOpenDetail={onOpenDetail}
        />
      ))}
      {heartbeats.length === 0 && !createAgentId ? (
        <Text style={styles.empty}>{t("heartbeats.needsSession")}</Text>
      ) : null}
      {heartbeats.length === 0 && emptyHint && createAgentId ? (
        <Text style={styles.empty}>{emptyHint}</Text>
      ) : null}
      {createAgentId ? (
        <DropdownMenuItem
          leading={NEW_ICON}
          onSelect={handleCreate}
          testID={`heartbeats-menu-new-${section.key}`}
        >
          {createLabel}
        </DropdownMenuItem>
      ) : null}
    </>
  );
}

function OtherSectionItems({
  serverId,
  section,
  heartbeats,
  onOpenDetail,
}: {
  serverId: string;
  section: HeartbeatSection;
  heartbeats: readonly AggregatedSchedule[];
  onOpenDetail: (scheduleId: string) => void;
}): ReactElement {
  return (
    <>
      <DropdownMenuItem
        leading={section.icon}
        trailing={OPEN_ICON}
        onSelect={section.onOpen}
        disabled={!section.onOpen}
        testID={`heartbeats-menu-open-${section.key}`}
      >
        {section.title}
      </DropdownMenuItem>
      {heartbeats.map((heartbeat) => (
        <HeartbeatRow
          key={heartbeat.id}
          serverId={serverId}
          heartbeat={heartbeat}
          onOpenDetail={onOpenDetail}
          indented
        />
      ))}
    </>
  );
}

/** A heartbeat: name, cadence and next run on one line, pause or resume without leaving the menu. */
function HeartbeatRow({
  serverId,
  heartbeat,
  onOpenDetail,
  indented = false,
}: {
  serverId: string;
  heartbeat: AggregatedSchedule;
  onOpenDetail: (scheduleId: string) => void;
  indented?: boolean;
}): ReactElement {
  const { t } = useTranslation();
  const paused = heartbeat.status === "paused";
  const handleOpen = useCallback(() => onOpenDetail(heartbeat.id), [heartbeat.id, onOpenDetail]);
  const handleToggle = useToggleHeartbeat(serverId, heartbeat.id, paused);
  const toggleLabel = paused ? t("heartbeats.resume") : t("heartbeats.pause");
  const trailing = useMemo(
    () => (
      <DropdownMenuItemAction
        icon={paused ? RESUME_ICON : PAUSE_ICON}
        label={toggleLabel}
        onPress={handleToggle}
        testID={`heartbeats-menu-toggle-${heartbeat.id}`}
      />
    ),
    [handleToggle, heartbeat.id, paused, toggleLabel],
  );
  return (
    <DropdownMenuItem
      style={indented ? styles.indented : undefined}
      description={heartbeatMeta(heartbeat, t)}
      descriptionLines={1}
      onSelect={handleOpen}
      testID={`heartbeats-menu-row-${heartbeat.id}`}
      trailing={isEnded(heartbeat) ? undefined : trailing}
    >
      {resolveScheduleTitle(heartbeat)}
    </DropdownMenuItem>
  );
}

/** Pause or resume from a list or card; a failure is shown, never dropped. */
export function useToggleHeartbeat(serverId: string, scheduleId: string | null, paused: boolean) {
  const mutations = useScheduleMutations({ serverId });
  const toast = useToast();
  const { pauseSchedule, resumeSchedule } = mutations;
  return useCallback(() => {
    if (!scheduleId) return;
    const action = paused ? resumeSchedule(scheduleId) : pauseSchedule(scheduleId);
    action.catch((cause: unknown) => toast.error(toErrorMessage(cause)));
  }, [pauseSchedule, paused, resumeSchedule, scheduleId, toast]);
}

const styles = StyleSheet.create((theme) => ({
  withCount: {
    width: "auto",
    flexDirection: "row",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
  },
  count: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  empty: {
    paddingHorizontal: theme.spacing[3],
    paddingBottom: theme.spacing[2],
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  indented: {
    paddingLeft: theme.spacing[6],
  },
}));
