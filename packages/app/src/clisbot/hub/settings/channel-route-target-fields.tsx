import { AutomationInputDraftContext } from "./automation-input-draft";
import { useContext } from "react";
import { AutomationReplyNavigationContext } from "./automation-reply-navigation";
import { useMemo } from "react";
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
import { MANAGED_BY_ORGANIZATION, routeTargetSummary } from "./channel-settings-records";
import { parseOptionalObject } from "./channel-route-form-state";

const ROUTE_TARGET_LABELS = {
  bot: "Start or continue a Bot",
  agent: "Start or continue an Agent",
  automation: "Run an Automation",
};
const EXPERIMENTAL_ROUTE_TARGET_NOTE = "Experimental";
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
  const options = useMemo<SelectFieldOption<string>[]>(
    () =>
      routes.map((route, index) => ({
        id: String(index),
        value: String(index),
        label: `Same as Route ${String(index + 1)} · ${routeTargetSummary(route)}`,
      })),
    [routes],
  );
  if (editedRoute !== undefined)
    return (
      <Field label="Target" hint={MANAGED_BY_ORGANIZATION}>
        <Text style={settingsStyles.rowTitle}>{routeTargetSummary(editedRoute)}</Text>
      </Field>
    );
  return (
    <SelectField
      label="Target"
      hint={`${MANAGED_BY_ORGANIZATION}. Pick the target of a Route this account already runs.`}
      value={selectedIndex}
      selectedDisplay={selectedOptionDisplay(options, selectedIndex)}
      options={options}
      onChange={onChange}
      placeholder="Choose a target"
      emptyText="This account has no Route to copy a target from."
      title="Target"
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
  const configureReplies = useContext(AutomationReplyNavigationContext);
  const inputDraft = useContext(AutomationInputDraftContext);
  if (inputDraft || automation === undefined || channel === undefined) return null;
  const grant = automationYamlChannelReplyGrant(automation.yaml, channel);
  if (grant === undefined)
    return (
      <View>
        <Alert
          variant="warning"
          title="This Automation has no Channel reply output"
          description={
            configureReplies
              ? "The run can start, but it cannot reply to this conversation. Configure a reply output, then save the Automation."
              : `Open ${automation.name} in Automations, choose Configuration, enable ${channel} replies on the step that responds, then save.`
          }
        />
        {configureReplies ? (
          <Button size="sm" variant="outline" onPress={configureReplies}>
            Configure reply output
          </Button>
        ) : null}
      </View>
    );
  return (
    <Text
      style={settingsStyles.rowHint}
    >{`Output target: source conversation. Automation allows ${grant.max ?? "unlimited"} ${channel} replies per run, subject to this Route’s reply policy.`}</Text>
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
  return (
    <>
      <ChoiceRow
        label="What should happen"
        values={targetValues}
        selected={target}
        labels={ROUTE_TARGET_LABELS}
        note={target === "automation" ? EXPERIMENTAL_ROUTE_TARGET_NOTE : undefined}
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
  return (
    <>
      <SelectField
        label="Automation"
        value={automationName}
        selectedDisplay={automationDisplay}
        options={automationOptions}
        onChange={setAutomationName}
        placeholder="Choose an Automation"
        emptyText="No Automation is available yet."
        searchable={automationOptions.length > 6}
        title="Automation"
        disabled={pending || automationCreatePending}
      />
      <Button
        size="xs"
        variant="outline"
        disabled={pending || automationCreatePending || showAutomationCreator}
        onPress={showAutomationForm}
      >
        Create Automation
      </Button>
      <Text style={settingsStyles.rowHint}>
        The new Automation is selected here without clearing this Route draft.
      </Text>
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
  const workspaceField = useMemo(
    () => ({ value: workspace, onChange: setWorkspace }),
    [setWorkspace, workspace],
  );
  return (
    <>
      <SelectField
        label="Host"
        value={daemonId}
        selectedDisplay={daemonDisplay}
        options={daemonOptions}
        onChange={changeDaemon}
        placeholder="Choose a Host"
        emptyText="Enroll a Daemon first."
        searchable={daemonOptions.length > 6}
        title="Host"
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
  const providerOptionsError = parsedProviderOptions.valid
    ? null
    : 'Enter a JSON object, for example {"setting": true}.';
  return (
    <>
      <ManagedAgentFastModeSwitch
        serverId={selectedDaemonServerId}
        value={agentConfiguration}
        onChange={setAgentConfiguration}
        disabled={pending}
      />
      <Field
        label="Provider options"
        hint="Optional JSON object for provider-specific settings."
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
