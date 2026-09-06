import type { UseQueryResult } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import type { z } from "zod";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useFetchQuery } from "@/data/query";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { useHubAccount } from "../account-provider";
import { HubAutomationRunDetailsSchema, type HubAutomationActivitySchema } from "../contracts";
import { hubResourceQueryKey } from "../query-keys";

type Activity = z.infer<typeof HubAutomationActivitySchema>;
type RunDetails = z.infer<typeof HubAutomationRunDetailsSchema>;

export function AutomationActivity({
  automationId,
  activity,
}: {
  automationId: string;
  activity: UseQueryResult<Activity, Error>;
}) {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const closeDetails = useCallback(() => setSelectedRunId(null), []);
  const refresh = useCallback(() => void activity.refetch(), [activity]);
  const refreshAction = useMemo(
    () => (
      <Button size="sm" variant="ghost" loading={activity.isFetching} onPress={refresh}>
        Refresh
      </Button>
    ),
    [activity.isFetching, refresh],
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
    <SettingsSection title="Activity" trailing={refreshAction}>
      {activity.isPending ? <Text style={settingsStyles.rowHint}>Loading activity...</Text> : null}
      {activity.error ? (
        <Alert variant="error" title="Activity unavailable" description={activity.error.message}>
          <Button size="sm" variant="outline" onPress={refresh}>
            Retry
          </Button>
        </Alert>
      ) : null}
      {activity.data ? (
        <View style={settingsStyles.card}>
          {activity.data.activity.length === 0 ? (
            <Text style={settingsStyles.rowHint}>No runs yet.</Text>
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
  const open = useCallback(() => select(run.id), [run.id, select]);
  return (
    <View style={[settingsStyles.row, bordered ? settingsStyles.rowBorder : null]}>
      <View style={settingsStyles.rowContent}>
        <Text
          style={settingsStyles.rowTitle}
        >{`${run.status.replaceAll("_", " ")} · ${run.provider}`}</Text>
        <Text style={settingsStyles.rowHint}>{new Date(run.createdAt).toLocaleString()}</Text>
        {run.error ? <Text style={settingsStyles.rowHint}>{run.error}</Text> : null}
      </View>
      <Button size="sm" variant="ghost" onPress={open}>
        View details
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
        Refresh
      </Button>
    ),
    [details.isFetching, refresh],
  );
  return (
    <SettingsSection title="Run details" trailing={refreshAction}>
      <Button size="sm" variant="outline" onPress={close}>
        Back to Activity
      </Button>
      {details.isPending ? (
        <Text style={settingsStyles.rowHint}>Loading run details...</Text>
      ) : null}
      {details.error ? (
        <Alert variant="error" title="Run details unavailable" description={details.error.message}>
          <Button size="sm" variant="outline" onPress={refresh}>
            Retry
          </Button>
        </Alert>
      ) : null}
      {details.data ? <RunSummary details={details.data} /> : null}
    </SettingsSection>
  );
}

function RunSummary({ details }: { details: RunDetails }) {
  return (
    <View>
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{details.status.replaceAll("_", " ")}</Text>
            <Text
              style={settingsStyles.rowHint}
            >{`Started ${new Date(details.createdAt).toLocaleString()}`}</Text>
            {details.completedAt ? (
              <Text
                style={settingsStyles.rowHint}
              >{`Completed ${new Date(details.completedAt).toLocaleString()}`}</Text>
            ) : null}
          </View>
        </View>
      </View>
      {details.error ? (
        <Alert variant="error" title="Run error" description={details.error} />
      ) : null}
      <SettingsSection title="Steps">
        <View style={settingsStyles.card}>
          {details.steps.length === 0 ? (
            <Text style={settingsStyles.rowHint}>No steps were started for this run.</Text>
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
  const outputs = Object.entries(step.outputs);
  return (
    <View style={[settingsStyles.row, bordered ? settingsStyles.rowBorder : null]}>
      <View style={settingsStyles.rowContent}>
        <Text
          style={settingsStyles.rowTitle}
        >{`${step.name} · ${step.status.replaceAll("_", " ")}`}</Text>
        {step.startedAt ? (
          <Text
            style={settingsStyles.rowHint}
          >{`Started ${new Date(step.startedAt).toLocaleString()}`}</Text>
        ) : null}
        {step.completedAt ? (
          <Text
            style={settingsStyles.rowHint}
          >{`Completed ${new Date(step.completedAt).toLocaleString()}`}</Text>
        ) : null}
        {step.error ? <Text style={settingsStyles.rowHint}>{step.error}</Text> : null}
        {outputs.length === 0 ? (
          <Text style={settingsStyles.rowHint}>No outputs recorded.</Text>
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
