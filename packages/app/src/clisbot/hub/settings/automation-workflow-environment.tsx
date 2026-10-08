import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/select-field";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { useIsCompactFormFactor } from "@/constants/layout";
import { settingsStyles } from "@/styles/settings";
import type { AutomationWorkflowModel } from "../automation-workflow-model";
import { DaemonProjectField } from "./daemon-project-field";
import { workflowStyles as styles } from "./automation-workflow-styles";

export interface WorkflowDaemon {
  id: string;
  slug: string;
  connectionOffer: { serverId: string } | null;
}

export function WorkflowEnvironment({
  environment,
  index,
  model,
  pending,
  daemons,
}: {
  environment: Record<string, unknown>;
  index: number;
  model: AutomationWorkflowModel;
  pending: boolean;
  daemons: WorkflowDaemon[];
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(!environment.daemon);
  const toggle = useCallback(() => setExpanded((value) => !value), []);
  const trailing = useMemo(
    () => (
      <Button size="sm" variant="ghost" onPress={toggle}>
        {expanded
          ? t("hub.automations.workflow.collapse")
          : t("hub.automations.workflow.editTarget")}
      </Button>
    ),
    [expanded, t, toggle],
  );
  const daemon = daemons.find(
    (value) => value.id === environment.daemon || value.slug === environment.daemon,
  );
  return (
    <SettingsSection
      title={t("hub.automations.workflow.environmentTitle", { name: String(environment.name) })}
      trailing={trailing}
    >
      {expanded && environment.kind === "daemon" ? (
        <EnvironmentTarget
          environment={environment}
          index={index}
          model={model}
          pending={pending}
          daemons={daemons}
          daemon={daemon}
        />
      ) : (
        <Text style={settingsStyles.rowHint}>
          {daemon?.slug ?? String(environment.kind)} · {String(environment.cwd ?? "")}
        </Text>
      )}
    </SettingsSection>
  );
}

function EnvironmentTarget({
  environment,
  index,
  model,
  pending,
  daemons,
  daemon,
}: {
  environment: Record<string, unknown>;
  index: number;
  model: AutomationWorkflowModel;
  pending: boolean;
  daemons: WorkflowDaemon[];
  daemon: WorkflowDaemon | undefined;
}) {
  const { t } = useTranslation();
  const size = useIsCompactFormFactor() ? "md" : "sm";
  const hostLabel = daemon?.slug ?? String(environment.daemon);
  const selectedHost = useMemo(() => ({ label: hostLabel }), [hostLabel]);
  const hostOptions = useMemo(
    () => daemons.map((value) => ({ id: value.id, value: value.id, label: value.slug })),
    [daemons],
  );
  const chooseHost = useCallback(
    (value: string) => {
      model.set(["environments", index, "daemon"], value);
      model.set(["environments", index, "projectId"], undefined);
    },
    [index, model],
  );
  const chooseProject = useCallback(
    (value: string) => model.set(["environments", index, "projectId"], value),
    [index, model],
  );
  const changeCwd = useCallback(
    (value: string) => model.set(["environments", index, "cwd"], value),
    [index, model],
  );
  return (
    <View style={styles.form}>
      <SelectField
        label={t("hub.automations.form.host")}
        selectedDisplay={selectedHost}
        value={String(environment.daemon)}
        placeholder={t("hub.automations.workflow.chooseHost")}
        emptyText={t("hub.automations.workflow.noHosts")}
        size={size}
        options={hostOptions}
        onChange={chooseHost}
        disabled={pending}
      />
      <DaemonProjectField
        key={String(environment.daemon)}
        daemonId={daemon?.id ?? null}
        serverId={daemon?.connectionOffer?.serverId ?? null}
        value={typeof environment.projectId === "string" ? environment.projectId : null}
        cwd={String(environment.cwd ?? "")}
        onChange={chooseProject}
        onCwdChange={changeCwd}
        disabled={pending}
      />
    </View>
  );
}
