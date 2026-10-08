import { AutomationInputDraftContext } from "./automation-input-draft";
import { useContext } from "react";
import { AutomationReplyNavigationContext } from "./automation-reply-navigation";
import type { TFunction } from "i18next";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ChoiceRow } from "./channel-route-behavior-rows";
import { Text, View } from "react-native";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { SelectField, type SelectFieldOption } from "@/components/ui/select-field";
import { settingsStyles } from "@/styles/settings";
import { automationYamlChannelReplyGrant } from "../automation-configuration";
import { DaemonProjectField } from "./daemon-project-field";
import {
  ManagedAgentConfigurationFields,
  ManagedAgentFastModeSwitch,
  type ManagedAgentConfigurationValue,
} from "./managed-agent-configuration-fields";
import { workspaceConfigurationFromTarget } from "../workspace-configuration";
import { selectedOptionDisplay } from "./channel-identity-form-parts";
import { type HubAutomation, type RecordValue, type RouteTarget } from "./channel-settings-types";
import { routeTargetSummary } from "./channel-settings-records";
import { parseOptionalObject } from "./channel-route-form-state";

function routeTargetLabels(t: TFunction) {
  return {
    bot: t("hub.routes.target.choices.bot"),
    agent: t("hub.routes.target.choices.agent"),
    automation: t("hub.routes.target.choices.automation"),
  };
}
/**
 * What a Connection Admin sees for the target: the Route keeps the Agent or
 * Automation it has, since the shared resource file that defines it is the
 * organization's. A new Route of theirs copies the target of one the account
 * already runs.
 */
export function ChannelRouteAdminTarget({
  editedRoute,
  routes,
  selectedIndex,
  onChange,
  disabled,
}: {
  editedRoute: RecordValue | undefined;
  routes: RecordValue[];
  selectedIndex: string | null;
  onChange(index: string | null): void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const options = useMemo<SelectFieldOption<string>[]>(
    () =>
      routes.map((route, index) => ({
        id: String(index),
        value: String(index),
        label: t("hub.routes.target.sameAsRoute", {
          number: index + 1,
          target: routeTargetSummary(route),
        }),
      })),
    [routes, t],
  );
  if (editedRoute !== undefined)
    return (
      <Field label={t("hub.routes.target.label")} hint={t("hub.routes.target.managed")}>
        <Text style={settingsStyles.rowTitle}>{routeTargetSummary(editedRoute)}</Text>
      </Field>
    );
  return (
    <SelectField
      label={t("hub.routes.target.label")}
      hint={t("hub.routes.target.managedPick")}
      value={selectedIndex}
      selectedDisplay={selectedOptionDisplay(options, selectedIndex)}
      options={options}
      onChange={onChange}
      placeholder={t("hub.routes.target.choose")}
      emptyText={t("hub.routes.target.noRouteToCopy")}
      title={t("hub.routes.target.label")}
      disabled={disabled}
    />
  );
}

export function AutomationReplyAuthority({
  automation,
  channel,
}: {
  automation: HubAutomation | undefined;
  channel: string | undefined;
}) {
  const { t } = useTranslation();
  const configureReplies = useContext(AutomationReplyNavigationContext);
  const inputDraft = useContext(AutomationInputDraftContext);
  if (inputDraft || automation === undefined || channel === undefined) return null;
  const grant = automationYamlChannelReplyGrant(automation.yaml, channel);
  if (grant === undefined)
    return (
      <View>
        <Alert
          variant="warning"
          title={t("hub.routes.target.noReplyOutputTitle")}
          description={
            configureReplies
              ? t("hub.routes.target.configureDescription")
              : t("hub.routes.target.openDescription", { automation: automation.name, channel })
          }
        />
        {configureReplies ? (
          <Button size="sm" variant="outline" onPress={configureReplies}>
            {t("hub.routes.target.configureReplyOutput")}
          </Button>
        ) : null}
      </View>
    );
  return (
    <Text style={settingsStyles.rowHint}>
      {t("hub.routes.target.outputTarget", {
        max: String(grant.max ?? t("hub.routes.target.unlimited")),
        channel,
      })}
    </Text>
  );
}

export function RouteTargetFields({
  target,
  targetValues,
  changeTarget,
  automationName,
  automationDisplay,
  automationOptions,
  setAutomationName,
  automationCreatePending,
  showAutomationCreator,
  showAutomationForm,
  automationCreateError,
  daemonId,
  daemonDisplay,
  daemonOptions,
  changeDaemon,
  projectId,
  setProjectId,
  cwd,
  setCwd,
  workspace,
  setWorkspace,
  selectedDaemonServerId,
  agentConfiguration,
  setAgentConfiguration,
  pending,
}: {
  target: RouteTarget;
  targetValues: string[];
  changeTarget(value: string): void;
  automationName: string | null;
  automationDisplay: { label: string; description?: string } | null;
  automationOptions: SelectFieldOption<string>[];
  setAutomationName(value: string | null): void;
  automationCreatePending: boolean;
  showAutomationCreator: boolean;
  showAutomationForm(): void;
  automationCreateError: string | null;
  daemonId: string | null;
  daemonDisplay: { label: string; description?: string } | null;
  daemonOptions: SelectFieldOption<string>[];
  changeDaemon(value: string | null): void;
  projectId: string | null;
  setProjectId(value: string | null): void;
  cwd: string;
  setCwd(value: string): void;
  workspace: ReturnType<typeof workspaceConfigurationFromTarget>;
  setWorkspace(value: ReturnType<typeof workspaceConfigurationFromTarget>): void;
  selectedDaemonServerId: string | null;
  agentConfiguration: ManagedAgentConfigurationValue;
  setAgentConfiguration(value: ManagedAgentConfigurationValue): void;
  pending: boolean;
}) {
  const { t } = useTranslation();
  return (
    <>
      <ChoiceRow
        label={t("hub.routes.target.whatShouldHappen")}
        values={targetValues}
        selected={target}
        labels={routeTargetLabels(t)}
        note={target === "automation" ? t("hub.routes.target.experimental") : undefined}
        onChange={changeTarget}
        disabled={pending}
      />
      {target === "automation" ? (
        <AutomationTargetFields
          automationName={automationName}
          automationDisplay={automationDisplay}
          automationOptions={automationOptions}
          setAutomationName={setAutomationName}
          automationCreatePending={automationCreatePending}
          showAutomationCreator={showAutomationCreator}
          showAutomationForm={showAutomationForm}
          automationCreateError={automationCreateError}
          pending={pending}
        />
      ) : null}
      {target === "agent" ? (
        <AgentTargetFields
          daemonId={daemonId}
          daemonDisplay={daemonDisplay}
          daemonOptions={daemonOptions}
          changeDaemon={changeDaemon}
          projectId={projectId}
          setProjectId={setProjectId}
          cwd={cwd}
          setCwd={setCwd}
          workspace={workspace}
          setWorkspace={setWorkspace}
          selectedDaemonServerId={selectedDaemonServerId}
          agentConfiguration={agentConfiguration}
          setAgentConfiguration={setAgentConfiguration}
          pending={pending}
        />
      ) : null}
    </>
  );
}

function AutomationTargetFields({
  automationName,
  automationDisplay,
  automationOptions,
  setAutomationName,
  automationCreatePending,
  showAutomationCreator,
  showAutomationForm,
  automationCreateError,
  pending,
}: {
  automationName: string | null;
  automationDisplay: { label: string; description?: string } | null;
  automationOptions: SelectFieldOption<string>[];
  setAutomationName(value: string | null): void;
  automationCreatePending: boolean;
  showAutomationCreator: boolean;
  showAutomationForm(): void;
  automationCreateError: string | null;
  pending: boolean;
}) {
  const { t } = useTranslation();
  return (
    <>
      <SelectField
        label={t("hub.routes.target.automation")}
        value={automationName}
        selectedDisplay={automationDisplay}
        options={automationOptions}
        onChange={setAutomationName}
        placeholder={t("hub.routes.target.chooseAutomation")}
        emptyText={t("hub.routes.target.noAutomation")}
        searchable={automationOptions.length > 6}
        title={t("hub.routes.target.automation")}
        disabled={pending || automationCreatePending}
      />
      <Button
        size="xs"
        variant="outline"
        disabled={pending || automationCreatePending || showAutomationCreator}
        onPress={showAutomationForm}
      >
        {t("hub.routes.target.createAutomation")}
      </Button>
      <Text style={settingsStyles.rowHint}>{t("hub.routes.target.createHint")}</Text>
      {automationCreateError ? <Alert variant="error" title={automationCreateError} /> : null}
    </>
  );
}

function AgentTargetFields({
  daemonId,
  daemonDisplay,
  daemonOptions,
  changeDaemon,
  projectId,
  setProjectId,
  cwd,
  setCwd,
  workspace,
  setWorkspace,
  selectedDaemonServerId,
  agentConfiguration,
  setAgentConfiguration,
  pending,
}: {
  daemonId: string | null;
  daemonDisplay: { label: string; description?: string } | null;
  daemonOptions: SelectFieldOption<string>[];
  changeDaemon(value: string | null): void;
  projectId: string | null;
  setProjectId(value: string | null): void;
  cwd: string;
  setCwd(value: string): void;
  workspace: ReturnType<typeof workspaceConfigurationFromTarget>;
  setWorkspace(value: ReturnType<typeof workspaceConfigurationFromTarget>): void;
  selectedDaemonServerId: string | null;
  agentConfiguration: ManagedAgentConfigurationValue;
  setAgentConfiguration(value: ManagedAgentConfigurationValue): void;
  pending: boolean;
}) {
  const { t } = useTranslation();
  const workspaceField = useMemo(
    () => ({ value: workspace, onChange: setWorkspace }),
    [setWorkspace, workspace],
  );
  return (
    <>
      <SelectField
        label={t("hub.routes.target.host")}
        value={daemonId}
        selectedDisplay={daemonDisplay}
        options={daemonOptions}
        onChange={changeDaemon}
        placeholder={t("hub.routes.target.chooseHost")}
        emptyText={t("hub.routes.target.enrollDaemon")}
        searchable={daemonOptions.length > 6}
        title={t("hub.routes.target.host")}
        disabled={pending}
      />
      <DaemonProjectField
        daemonId={daemonId}
        serverId={selectedDaemonServerId}
        value={projectId}
        cwd={cwd}
        onChange={setProjectId}
        onCwdChange={setCwd}
        workspace={workspaceField}
        disabled={pending}
      />
      <ManagedAgentConfigurationFields
        serverId={selectedDaemonServerId}
        cwd={cwd}
        value={agentConfiguration}
        onChange={setAgentConfiguration}
        showFastMode={false}
        disabled={pending}
      />
    </>
  );
}

/** Provider-specific settings, folded under Advanced on a direct Agent Route. */
export function AgentAdvancedFields({
  selectedDaemonServerId,
  agentConfiguration,
  setAgentConfiguration,
  providerOptions,
  parsedProviderOptions,
  setProviderOptions,
  pending,
}: {
  selectedDaemonServerId: string | null;
  agentConfiguration: ManagedAgentConfigurationValue;
  setAgentConfiguration(value: ManagedAgentConfigurationValue): void;
  providerOptions: string;
  parsedProviderOptions: ReturnType<typeof parseOptionalObject>;
  setProviderOptions(value: string): void;
  pending: boolean;
}) {
  const { t } = useTranslation();
  const providerOptionsError = parsedProviderOptions.valid
    ? null
    : t("hub.routes.target.providerOptionsError");
  return (
    <>
      <ManagedAgentFastModeSwitch
        serverId={selectedDaemonServerId}
        value={agentConfiguration}
        onChange={setAgentConfiguration}
        disabled={pending}
      />
      <Field
        label={t("hub.routes.target.providerOptions")}
        hint={t("hub.routes.target.providerOptionsHint")}
        error={providerOptionsError}
      >
        <FormTextInput
          initialValue={providerOptions}
          onChangeText={setProviderOptions}
          placeholder='{"setting": true}'
          autoCapitalize="none"
          autoCorrect={false}
          multiline
          editable={!pending}
        />
      </Field>
    </>
  );
}
