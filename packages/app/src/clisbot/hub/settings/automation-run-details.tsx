import type { UseQueryResult } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { z } from "zod";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useFetchQuery } from "@/data/query";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { useHubAccount } from "../account-provider";
import { HubAutomationRunDetailsSchema, type HubAutomationActivitySchema } from "../contracts";
import { hubResourceQueryKey } from "../query-keys";
import { BackLink } from "./back-link";

type Activity = z.infer<typeof HubAutomationActivitySchema>;
type RunDetails = z.infer<typeof HubAutomationRunDetailsSchema>;

export function AutomationActivity({
  automationId,
  activity,
}: {
  automationId: string;
  activity: UseQueryResult<Activity, Error>;
}) {
  const { t } = useTranslation();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const closeDetails = useCallback(() => setSelectedRunId(null), []);
  const refresh = useCallback(() => void activity.refetch(), [activity]);
  const refreshAction = useMemo(
    () => (
      <Button size="sm" variant="ghost" loading={activity.isFetching} onPress={refresh}>
        {t("hub.automations.activity.refresh")}
      </Button>
    ),
    [activity.isFetching, refresh, t],
  );
  if (selectedRunId !== null) {
    return (
      <AutomationRunDetails
        key={selectedRunId}
        automationId={automationId}
        runId={selectedRunId}
        close={closeDetails}
      />
    );
  }
  return (
    <SettingsSection title={t("hub.automations.activity.title")} trailing={refreshAction}>
      {activity.isPending ? (
        <Text style={settingsStyles.rowHint}>{t("hub.automations.activity.loading")}</Text>
      ) : null}
      {activity.error ? (
        <Alert
          variant="error"
          title={t("hub.automations.activity.unavailable")}
          description={activity.error.message}
        >
          <Button size="sm" variant="outline" onPress={refresh}>
            {t("common.actions.retry")}
          </Button>
        </Alert>
      ) : null}
      {activity.data ? (
        <View style={settingsStyles.card}>
          {activity.data.activity.length === 0 ? (
            <Text style={settingsStyles.rowHint}>{t("hub.automations.activity.noRuns")}</Text>
          ) : null}
          {activity.data.activity.map((run, index) => (
            <AutomationActivityRow
              key={run.id}
              run={run}
              bordered={index > 0}
              select={setSelectedRunId}
            />
          ))}
        </View>
      ) : null}
    </SettingsSection>
  );
}

function AutomationActivityRow({
  run,
  bordered,
  select,
}: {
  run: Activity["activity"][number];
  bordered: boolean;
  select(runId: string): void;
}) {
  const { t } = useTranslation();
  const open = useCallback(() => select(run.id), [run.id, select]);
  return (
    <View style={[settingsStyles.row, bordered ? settingsStyles.rowBorder : null]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>
          {t("hub.automations.activity.rowTitle", {
            status: t(`hub.automations.status.${run.status}`),
            provider: run.provider,
          })}
        </Text>
        <Text style={settingsStyles.rowHint}>{new Date(run.createdAt).toLocaleString()}</Text>
        {run.error ? <Text style={settingsStyles.rowHint}>{run.error}</Text> : null}
      </View>
      <Button size="sm" variant="ghost" onPress={open}>
        {t("hub.automations.activity.viewDetails")}
      </Button>
    </View>
  );
}

export function AutomationRunDetails({
  automationId,
  runId,
  close,
}: {
  automationId: string;
  runId: string;
  close(): void;
}) {
  const { t } = useTranslation();
  const hub = useHubAccount();
  const accountId = hub.signedIn?.account.id ?? null;
  const organizationId = hub.signedIn?.organization.id ?? null;
  const details = useFetchQuery({
    queryKey: [
      ...hubResourceQueryKey({ origin: hub.origin, organizationId, accountId }, "automations"),
      automationId,
      "runs",
      runId,
    ],
    queryFn: () =>
      hub
        .api()
        .get(
          `automations/${encodeURIComponent(automationId)}/runs/${encodeURIComponent(runId)}`,
          HubAutomationRunDetailsSchema,
        ),
    enabled: organizationId !== null && hub.signedIn?.capabilities.manageResources === true,
    dataShape: "value",
    retry: false,
    staleTimeMs: 0,
    refetchInterval: (query) => (query.state.data?.status === "running" ? 5_000 : false),
  });
  const refresh = useCallback(() => void details.refetch(), [details]);
  const refreshAction = useMemo(
    () => (
      <Button size="sm" variant="ghost" loading={details.isFetching} onPress={refresh}>
        {t("hub.automations.activity.refresh")}
      </Button>
    ),
    [details.isFetching, refresh, t],
  );
  return (
    <>
      <BackLink to={t("hub.automations.activity.title")} onPress={close} />
      <SettingsSection title={t("hub.automations.runDetails.title")} trailing={refreshAction}>
        {details.isPending ? (
          <Text style={settingsStyles.rowHint}>{t("hub.automations.runDetails.loading")}</Text>
        ) : null}
        {details.error ? (
          <Alert
            variant="error"
            title={t("hub.automations.runDetails.unavailable")}
            description={details.error.message}
          >
            <Button size="sm" variant="outline" onPress={refresh}>
              {t("common.actions.retry")}
            </Button>
          </Alert>
        ) : null}
        {details.data ? <RunSummary details={details.data} /> : null}
      </SettingsSection>
    </>
  );
}

function RunSummary({ details }: { details: RunDetails }) {
  const { t } = useTranslation();
  return (
    <View>
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>
              {t(`hub.automations.status.${details.status}`)}
            </Text>
            <RunTime kind="started" at={details.createdAt} />
            <RunTime kind="completed" at={details.completedAt} />
          </View>
        </View>
      </View>
      {details.error ? (
        <Alert
          variant="error"
          title={t("hub.automations.runDetails.error")}
          description={details.error}
        />
      ) : null}
      <SettingsSection title={t("hub.automations.runDetails.steps")}>
        <View style={settingsStyles.card}>
          {details.steps.length === 0 ? (
            <Text style={settingsStyles.rowHint}>{t("hub.automations.runDetails.noSteps")}</Text>
          ) : null}
          {details.steps.map((step, index) => (
            <RunStep key={step.id} step={step} bordered={index > 0} />
          ))}
        </View>
      </SettingsSection>
    </View>
  );
}

function RunStep({ step, bordered }: { step: RunDetails["steps"][number]; bordered: boolean }) {
  const { t } = useTranslation();
  const outputs = Object.entries(step.outputs);
  return (
    <View style={[settingsStyles.row, bordered ? settingsStyles.rowBorder : null]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>
          {t("hub.automations.runDetails.stepTitle", {
            name: step.name,
            status: t(`hub.automations.status.${step.status}`),
          })}
        </Text>
        <RunTime kind="started" at={step.startedAt} />
        <RunTime kind="completed" at={step.completedAt} />
        {step.error ? <Text style={settingsStyles.rowHint}>{step.error}</Text> : null}
        {outputs.length === 0 ? (
          <Text style={settingsStyles.rowHint}>{t("hub.automations.runDetails.noOutputs")}</Text>
        ) : (
          outputs.map(([name, count]) => (
            <Text
              key={name}
              style={settingsStyles.rowHint}
            >{`${name.replaceAll(".", " ")}: ${count}`}</Text>
          ))
        )}
      </View>
    </View>
  );
}

/** "Started …" / "Completed …" under a run or step; nothing when the time is unknown. */
function RunTime({ kind, at }: { kind: "started" | "completed"; at: string | null }) {
  const { t } = useTranslation();
  if (!at) return null;
  const time = new Date(at).toLocaleString();
  return (
    <Text style={settingsStyles.rowHint}>
      {kind === "started"
        ? t("hub.automations.runDetails.started", { time })
        : t("hub.automations.runDetails.completed", { time })}
    </Text>
  );
}
