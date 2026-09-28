import { useCallback, useState, type ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useIsCompactFormFactor } from "@/constants/layout";
import { Button } from "@/components/ui/button";
import { ScheduleFormSheet } from "@/components/schedules/schedule-form-sheet";
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
  return (
    <ScrollView>
      <View style={styles.page}>
        <HomeSchedules onSeeAll={onSchedules} />
        <HomeAutomations onOpen={onAutomations} />
        <View style={styles.section}>
          <Text style={styles.title}>Get started</Text>
          <Text style={styles.text}>
            Schedules run agents on a Host at a chosen time. Use them for recurring tasks and
            reminders.
          </Text>
          <Text style={styles.text}>
            Automations connect a Project to events, schedules or manual runs through your
            organization.
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}

function HomeSection({
  title,
  onCreate,
  onSeeAll,
  children,
}: {
  title: string;
  onCreate?: () => void;
  onSeeAll: () => void;
  children: ReactNode;
}) {
  const compact = useIsCompactFormFactor();
  const size = compact ? "md" : "sm";
  return (
    <View style={styles.section}>
      <Text style={styles.title}>{title}</Text>
      <View style={styles.actions}>
        {onCreate ? (
          <Button variant="outline" size={size} onPress={onCreate}>
            New {title === "Schedules" ? "schedule" : "automation"}
          </Button>
        ) : null}
        <Button variant="ghost" size={size} onPress={onSeeAll}>
          See all
        </Button>
      </View>
      {children}
    </View>
  );
}

function HomeSchedules({ onSeeAll }: { onSeeAll: () => void }) {
  const { loadState, hostErrors, isError, refetch } = useSchedules();
  const [form, setForm] = useState<"create" | AggregatedSchedule | null>(null);
  const open = useCallback(() => setForm("create"), []);
  const close = useCallback(() => setForm(null), []);
  const ready = loadState.status === "loaded";
  let content: ReactNode;
  if (!ready)
    content = (
      <Text style={styles.text}>
        {isError ? "Could not load schedules." : "Connecting to Hosts…"}
      </Text>
    );
  else if (loadState.data.length)
    content = loadState.data
      .slice(0, 3)
      .map((schedule) => (
        <SchedulePreview
          key={`${schedule.serverId}:${schedule.id}`}
          schedule={schedule}
          onOpen={setForm}
        />
      ));
  else content = <Text style={styles.text}>No schedules yet.</Text>;
  return (
    <HomeSection title="Schedules" onCreate={open} onSeeAll={onSeeAll}>
      {content}
      {hostErrors.map((error) => (
        <Text key={error.serverId} style={styles.text}>
          {error.serverName}: could not load schedules.
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
  const open = useCallback(() => onOpen(schedule), [onOpen, schedule]);
  return (
    <Button variant="ghost" onPress={open}>
      {schedule.name} · {schedule.serverName}
    </Button>
  );
}

function HomeAutomations({ onOpen }: { onOpen: OpenAutomation }) {
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
  if (!hub.enabled) message = "Connect a Hub to use Automations.";
  else if (!hub.signedIn) message = "Sign in to view your organization’s Automations.";
  else if (query.isError) message = "Could not load Automations.";
  else if (!query.data) message = "Loading Automations…";
  else if (!query.data.automations.length) message = "No Automations yet.";
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
    <HomeSection title="Automations" onCreate={canCreate ? create : undefined} onSeeAll={seeAll}>
      {content}
      {query.isError ? (
        <Button variant="ghost" onPress={retry}>
          Retry
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
}));
