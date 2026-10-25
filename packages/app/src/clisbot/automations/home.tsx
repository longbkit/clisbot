import { useCallback, useState, type ReactNode } from "react";
import { Pressable, ScrollView, Text, View, type PressableStateCallbackType } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { useIsCompactFormFactor } from "@/constants/layout";
import { Button } from "@/components/ui/button";
import { ScheduleFormSheet } from "@/components/schedules/schedule-form-sheet";
import {
  ScheduleDetailSheet,
  ScheduleStatusBadge,
} from "@/clisbot/schedules/schedule-detail-sheet";
import { useCanCreateSchedules } from "@/clisbot/schedules/use-schedule-detail";
import { heartbeatMeta } from "@/clisbot/heartbeats/use-heartbeats";
import { resolveScheduleTitle } from "@/utils/schedule-format";
import { useSchedules, type AggregatedSchedule } from "@/hooks/use-schedules";
import { useFetchQuery } from "@/data/query";
import { useHubAccount } from "../hub/account-provider";
import { hubResourceQueryKey } from "../hub/query-keys";
import { HubEffectiveAccessSchema } from "../hub/contracts";
import { canCreateAutomation, HubScopedAutomationsSchema } from "../hub/settings/automation-access";

type OpenAutomation = (create: boolean) => void;
export function AutomationsHome({
  onSchedules,
  onAutomations,
}: {
  onSchedules: () => void;
  onAutomations: OpenAutomation;
}) {
  const { t } = useTranslation();
  return (
    <ScrollView>
      <View style={styles.page} testID="automations-home">
        <HomeSchedules onSeeAll={onSchedules} />
        <HomeAutomations onOpen={onAutomations} />
        <View style={styles.section}>
          <Text style={styles.title}>{t("home.schedulesLanding.getStarted")}</Text>
          <Text style={styles.text}>{t("home.schedulesLanding.schedulesHint")}</Text>
          <Text style={styles.text}>{t("home.schedulesLanding.automationsHint")}</Text>
        </View>
      </View>
    </ScrollView>
  );
}

function HomeSection({
  title,
  createLabel,
  onCreate,
  onSeeAll,
  children,
}: {
  title: string;
  createLabel: string;
  onCreate?: () => void;
  onSeeAll: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const compact = useIsCompactFormFactor();
  const size = compact ? "md" : "sm";
  return (
    <View style={styles.section}>
      <Text style={styles.title}>{title}</Text>
      <View style={styles.actions}>
        {onCreate ? (
          <Button variant="outline" size={size} onPress={onCreate}>
            {createLabel}
          </Button>
        ) : null}
        <Button variant="ghost" size={size} onPress={onSeeAll}>
          {t("home.schedulesLanding.seeAll")}
        </Button>
      </View>
      {children}
    </View>
  );
}

function HomeSchedules({ onSeeAll }: { onSeeAll: () => void }) {
  const { t } = useTranslation();
  const { loadState, hostErrors, isError, refetch } = useSchedules();
  const canCreate = useCanCreateSchedules();
  const [form, setForm] = useState<"create" | AggregatedSchedule | null>(null);
  const [detail, setDetail] = useState<AggregatedSchedule | null>(null);
  const open = useCallback(() => setForm("create"), []);
  const close = useCallback(() => setForm(null), []);
  const closeDetail = useCallback(() => setDetail(null), []);
  const editSettings = useCallback(() => {
    setForm(detail);
    setDetail(null);
  }, [detail]);
  const ready = loadState.status === "loaded";
  let content: ReactNode;
  if (!ready)
    content = (
      <Text style={styles.text}>
        {isError
          ? t("home.schedulesLanding.schedulesFailed")
          : t("home.schedulesLanding.connecting")}
      </Text>
    );
  else if (loadState.data.length)
    content = loadState.data
      .slice(0, 3)
      .map((schedule) => (
        <SchedulePreview
          key={`${schedule.serverId}:${schedule.id}`}
          schedule={schedule}
          onOpen={setDetail}
        />
      ));
  else content = <Text style={styles.text}>{t("home.schedulesLanding.noSchedules")}</Text>;
  return (
    <HomeSection
      title={t("home.schedulesLanding.schedules")}
      createLabel={t("home.schedulesLanding.newSchedule")}
      onCreate={canCreate ? open : undefined}
      onSeeAll={onSeeAll}
    >
      {content}
      {hostErrors.map((error) => (
        <Text key={error.serverId} style={styles.text}>
          {t("home.schedulesLanding.hostSchedulesFailed", { host: error.serverName })}
        </Text>
      ))}
      {isError ? (
        <Button variant="ghost" onPress={refetch}>
          Retry
        </Button>
      ) : null}
      <ScheduleFormSheet
        visible={form !== null}
        mode={form && form !== "create" ? "edit" : "create"}
        schedule={form && form !== "create" ? form : undefined}
        serverId={form && form !== "create" ? form.serverId : undefined}
        onClose={close}
      />
      {detail ? (
        <ScheduleDetailSheet
          serverId={detail.serverId}
          scheduleId={detail.id}
          onClose={closeDetail}
          onEditSettings={editSettings}
        />
      ) : null}
    </HomeSection>
  );
}
function SchedulePreview({
  schedule,
  onOpen,
}: {
  schedule: AggregatedSchedule;
  onOpen: (schedule: AggregatedSchedule) => void;
}) {
  const { t } = useTranslation();
  const open = useCallback(() => onOpen(schedule), [onOpen, schedule]);
  return (
    <Pressable
      onPress={open}
      style={previewRowStyle}
      accessibilityRole="button"
      testID={`automations-home-schedule-${schedule.id}`}
    >
      <View style={styles.rowHead}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {resolveScheduleTitle(schedule)}
        </Text>
        <ScheduleStatusBadge schedule={schedule} />
      </View>
      <Text style={styles.text} numberOfLines={1}>
        {heartbeatMeta(schedule, t, { withStatus: false })} · {schedule.serverName}
      </Text>
    </Pressable>
  );
}

function previewRowStyle({ pressed, hovered }: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.row, (hovered || pressed) && styles.rowActive];
}

function HomeAutomations({ onOpen }: { onOpen: OpenAutomation }) {
  const { t } = useTranslation();
  const hub = useHubAccount();
  const scope = {
    origin: hub.origin,
    organizationId: hub.signedIn?.organization.id ?? "",
    accountId: hub.signedIn?.account.id ?? null,
  };
  const enabled = Boolean(hub.enabled && hub.signedIn);
  const query = useFetchQuery({
    queryKey: hubResourceQueryKey(scope, "automations"),
    queryFn: () => hub.api().get("automations", HubScopedAutomationsSchema),
    enabled,
    retry: false,
    dataShape: "value",
    staleTimeMs: 15_000,
  });
  const access = useFetchQuery({
    queryKey: [...hubResourceQueryKey(scope, "access-assignments"), "effective"],
    queryFn: () => hub.api().get("access-assignments/effective", HubEffectiveAccessSchema),
    enabled,
    retry: false,
    dataShape: "value",
    staleTimeMs: 15_000,
  });
  const create = useCallback(() => onOpen(true), [onOpen]);
  const seeAll = useCallback(() => onOpen(false), [onOpen]);
  const retry = useCallback(() => {
    void query.refetch();
  }, [query]);
  const canCreate =
    enabled &&
    canCreateAutomation(hub.signedIn?.capabilities.manageResources === true, access.data);
  let message: string | null = null;
  if (!hub.enabled) message = t("home.schedulesLanding.connectHub");
  else if (!hub.signedIn) message = t("home.schedulesLanding.signIn");
  else if (query.isError) message = t("home.schedulesLanding.automationsFailed");
  else if (!query.data) message = t("home.schedulesLanding.loadingAutomations");
  else if (!query.data.automations.length) message = t("home.schedulesLanding.noAutomations");
  const content = message ? (
    <Text style={styles.text}>{message}</Text>
  ) : (
    query.data?.automations.slice(0, 3).map((automation) => (
      <Text key={automation.id} style={styles.text}>
        {automation.name}
      </Text>
    ))
  );
  return (
    <HomeSection
      title={t("home.schedulesLanding.automations")}
      createLabel={t("home.schedulesLanding.newAutomation")}
      onCreate={canCreate ? create : undefined}
      onSeeAll={seeAll}
    >
      {content}
      {query.isError ? (
        <Button variant="ghost" onPress={retry}>
          {t("home.schedulesLanding.retry")}
        </Button>
      ) : null}
    </HomeSection>
  );
}
const styles = StyleSheet.create((theme) => ({
  page: {
    padding: theme.spacing[4],
    gap: theme.spacing[4],
    width: "100%",
    maxWidth: 800,
    alignSelf: "center",
  },
  section: {
    padding: theme.spacing[4],
    gap: theme.spacing[3],
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
  },
  title: { color: theme.colors.foreground, fontSize: theme.fontSize.lg },
  text: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[2] },
  // One schedule per row, as in the heartbeat menu: name, then cadence, next run and Host.
  row: {
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    marginHorizontal: -theme.spacing[3],
    borderRadius: theme.borderRadius.md,
  },
  rowActive: { backgroundColor: theme.colors.surface2 },
  rowHead: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  rowTitle: { flexShrink: 1, color: theme.colors.foreground, fontSize: theme.fontSize.base },
}));
