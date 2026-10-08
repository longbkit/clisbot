import { AutomationInputDraftContext } from "./automation-input-draft";
import { useContext } from "react";
import { useChannelConfigurationPreview } from "./channel-settings-hooks";
import {
  audienceRuleErrors,
  audienceRuleFromDraft,
  audienceRulesComplete,
  effectiveConditions,
} from "./channel-route-audience";
import { AudienceRulesEditor, type AudienceOption } from "./channel-route-audience-fields";
import { useRulePeople } from "./channel-route-rule-people";
import { ruleSummary } from "./channel-route-rule-summary";
import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  FoldedRouteFormSubgroup,
  RouteFormSection,
  RoutePermissionFields,
  RouteReplyFields,
  DEFAULT_ROUTE_QUESTIONS,
} from "./channel-route-form-sections";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { settingsStyles } from "@/styles/settings";
import { useConfirmation } from "@/components/confirmation-provider";
import { channelRouteTargetValues, initialChannelRouteTarget } from "../channel-onboarding";
import {
  inheritedChannelOutboundPath,
  routeCarriesRuleConditions,
  type ChannelLimits,
} from "../channel-configuration";
import { type RouteBotRequest } from "../channel-route-bot";
import { BotTargetFields } from "./channel-route-bot-target";
import {
  RouteConversationSection,
  useRouteConversationDraft,
} from "./channel-route-conversation-fields";
import { useRouteToolActivityDraft } from "./channel-route-tool-activity-fields";
import { parseChannelLimitsDraft, type ChannelLimitsDraft } from "./channel-limits-draft";
import {
  isWorkspaceConfigurationValid,
  worktreeTargetFromConfiguration,
} from "../workspace-configuration";
import { type AutomationConnection, SingleAgentAutomationForm } from "./automation-settings";
import {
  EMPTY_RECORD,
  type EditingRoute,
  type HubAutomation,
  type HubConnection,
  type HubDaemon,
  type HubTeam,
  type RecordValue,
  type RouteTarget,
} from "./channel-settings-types";
import {
  arrayField,
  objectField,
  routeTargetSummary,
  stringField,
} from "./channel-settings-records";
import { useAudienceNames, useObservedConversations } from "./channel-observed-conversations";
import {
  useMountedRef,
  useRouteAgentTarget,
  useRouteAudienceState,
  useRouteAutomationCreator,
  useRouteBehaviorChanges,
  useRouteBotTarget,
  useRouteDestination,
  useRouteFormOptions,
  useRouteInheritedDefaults,
} from "./channel-route-form-hooks";
import { RouteConnectionSection, RouteLimitsSection } from "./channel-route-form-parts";
import {
  AgentAdvancedFields,
  AutomationReplyAuthority,
  ChannelRouteAdminTarget,
  RouteTargetFields,
} from "./channel-route-target-fields";
import {
  adminExistingTarget,
  channelFormInitialState,
  channelReplyProviderName,
  daemonServerId,
  formRouteTarget,
  isDuplicateChannelAccount,
  nextConfiguration,
  parseOptionalObject,
  routeLimitFields,
  routeConnectionStep,
  routeSaveBlocker,
} from "./channel-route-form-state";
import {
  channelFormSelection,
  parseRouteDestination,
  routeDestinationState,
  suggestedChannelAccountId,
} from "./channel-route-destination";
import { behaviorWithApprovalChoice } from "./channel-route-behavior-draft";
import {
  type RouteReviewInput,
  channelFormSubmitLabel,
  routeConfirmationTitle,
  routeReviewBody,
  routeReviewMessage,
  routeTargetReviewLabel,
  warningsForRoute,
} from "./channel-route-review";

interface ChannelAccountFormProps {
  automationName?: string;
  connections: HubConnection[];
  automationConnections: AutomationConnection[];
  automations: HubAutomation[];
  daemons: HubDaemon[];
  teams: HubTeam[];
  resource: RecordValue;
  /** The organization's `policy.yml`: its `defaults:` are what a Route inherits last. */
  policy: RecordValue;
  existingAccounts: RecordValue[];
  editing: EditingRoute | null;
  initialAccountKey: string | null;
  /** The Bot a new Route starts on ("Connect to a channel…"), or null. */
  initialBot: RouteBotRequest | null;
  /** The Connection is shown, not picked: an edit, or Add Route inside a Connection. */
  fixedAccount: boolean;
  createdConnectionId: string | null;
  /** A Connection named in the connect step: its first Route keeps that name. */
  namedConnectionId: string | null;
  pending: boolean;
  /** A Connection Admin: the target is shown, not edited, and saved as it is. */
  adminScoped: boolean;
  /** The last save's refusal, so rule-level Hub errors land on their rows. */
  saveError: string | null;
  cancelEdit(): void;
  /** Offered beside the Connection picker; absent when the Connection is fixed. */
  connectChannelAccount?: () => void;
  createRouteAutomation(yaml: string): Promise<string>;
  save(accounts: RecordValue[], resource: RecordValue, createdAccountKey?: string): void;
}

export function ChannelAccountForm({
  automationName: fixedAutomationName,
  connections,
  automationConnections,
  automations,
  daemons,
  teams,
  resource,
  policy,
  existingAccounts,
  editing,
  initialAccountKey,
  initialBot,
  fixedAccount,
  createdConnectionId,
  namedConnectionId,
  pending,
  adminScoped,
  saveError,
  cancelEdit,
  connectChannelAccount,
  createRouteAutomation,
  save,
}: ChannelAccountFormProps) {
  const { t } = useTranslation();
  const inputDraft = useContext(AutomationInputDraftContext);
  const previewWarnings = useChannelConfigurationPreview();
  const confirmDialog = useConfirmation();
  const mounted = useMountedRef();
  const initial = channelFormInitialState(existingAccounts, editing, resource);
  const { editedAccount, editedRoute, editedWorkflow, isEditing } = initial;
  const { destination, setDestination, accountIdDraft, setAccountId } = useRouteDestination(
    initialAccountKey,
    createdConnectionId,
    existingAccounts,
  );
  const { configurationKind, existingAccountKey, connectionId, destinationValue } =
    routeDestinationState(isEditing, initial.accountKey, destination);
  const suggestedAccountId = suggestedChannelAccountId(
    existingAccounts,
    connections.find(({ id }) => id === connectionId),
  );
  const accountId = accountIdDraft ?? suggestedAccountId;
  const audience = useRouteAudienceState(initial);
  const { audienceRules, setAudienceRules, open, replyPlaces } = audience;
  const { behavior, setBehavior, approvalChoice, setApprovalChoice } = audience;
  const audienceOptions = useMemo<{ teams: AudienceOption[] }>(
    () => ({ teams: teams.map(({ id, name }) => ({ id, name })) }),
    [teams],
  );
  const audienceErrors = useMemo(
    () =>
      saveError === null
        ? new Map<number, string>()
        : audienceRuleErrors(saveError, editing?.routeIndex ?? 0),
    [editing?.routeIndex, saveError],
  );

  const [routeLimits, setRouteLimits] = useState<ChannelLimitsDraft>(initial.routeLimits);
  const [target, setTarget] = useState<RouteTarget>(() =>
    initialBot === null ? initialChannelRouteTarget(isEditing, editedWorkflow) : "bot",
  );
  const [automationName, setAutomationName] = useState<string | null>(
    fixedAutomationName ?? editedWorkflow,
  );
  const agent = useRouteAgentTarget(initial, daemons);
  const { daemonId, projectId, cwd, workspace, agentConfiguration, providerOptions } = agent;
  const targetChosen = useRef(false);
  const routeBot = useRouteBotTarget({
    daemons,
    initialBot,
    editedRoute,
    editedEnvironment: initial.editedEnvironment,
    editedNamedAgent: initial.editedNamedAgent,
    targetChosen,
    setTarget,
  });
  const selection = channelFormSelection({
    existingAccounts,
    existingAccountKey,
    connections,
    configurationKind,
    connectionId,
    accountId,
  });
  const {
    selectedAccount,
    selectedConnection,
    effectiveAccountId,
    observedAccountChannel,
    observedAccountId,
  } = selection;
  const { inheritedConversation, inheritedToolActivity, inheritedConditions } =
    useRouteInheritedDefaults(policy, selectedAccount);
  const conversation = useRouteConversationDraft(editedRoute, inheritedConversation);
  const toolActivity = useRouteToolActivityDraft(editedRoute, inheritedToolActivity);
  // A Route that authors no Reply method shows the one it inherits.
  const replyBehavior = useMemo(() => {
    if (behavior.outboundPathInherited !== true) return behavior;
    const outboundPath = inheritedChannelOutboundPath([
      objectField(policy, "defaults") ?? undefined,
      objectField(selectedAccount ?? EMPTY_RECORD, "defaults") ?? undefined,
    ]);
    return { ...behavior, outboundPath };
  }, [behavior, policy, selectedAccount]);
  const observedConversations = useObservedConversations(
    observedAccountChannel,
    observedAccountId,
    true,
  );
  const audienceNames = useAudienceNames(observedConversations.data, teams);
  const rulePeople = useRulePeople({
    // The Connection's full record: the link facts and the link code read it.
    connection: connections.find(({ id }) => id === selectedConnection?.id),
    teams: audienceOptions.teams,
    watchLinks: false,
    // Only a saved, enabled account runs a bot that a `/link` can reach.
    listening: selectedAccount !== undefined && selectedAccount["enabled"] !== false,
  });
  const parsedProviderOptions = parseOptionalObject(providerOptions);
  const parsedRouteLimits = parseChannelLimitsDraft(routeLimits);
  // The totals, and any other limit an earlier version set on the Route, so
  // it stays visible and editable; read once, so a field never vanishes mid-edit.
  const [routeLimitNames] = useState(() => routeLimitFields(initial.routeLimits));
  const options = useRouteFormOptions({
    existingAccounts,
    connections,
    adminScoped,
    provider: inputDraft?.provider,
    daemons,
    automations,
    destinationValue,
    automationName,
    daemonId,
  });
  const selectedDaemonServerId = daemonServerId(daemons, daemonId);
  // A Connection Admin keeps the Route's target; a new Route of theirs
  // copies the target of one the account already has.
  const [existingTargetIndex, setExistingTargetIndex] = useState<string | null>(null);
  const existingTarget = adminExistingTarget(
    adminScoped,
    editedRoute,
    selectedAccount,
    existingTargetIndex,
  );
  const hubPredatesRules = editedRoute !== undefined && routeCarriesRuleConditions(editedRoute);
  const connectionStep = routeConnectionStep({
    configurationKind,
    connectionId,
    selectedConnection,
    namedConnectionId,
  });
  const saveBlocker = routeSaveBlocker({
    conversationValid: conversation.parsed.valid,
    toolActivityValid: toolActivity.parsed.valid,
    selectedConnection,
    connectionLoading: connectionStep.connectionLoading,
    effectiveAccountId,
    configurationKind,
    selectedAccount,
    audienceComplete:
      !hubPredatesRules && audienceRulesComplete(audienceRules, inheritedConditions),
    parsedRouteLimits,
    existingTarget,
    target,
    automationName,
    bot: routeBot.selected,
    daemonId,
    projectId,
    cwd,
    workspaceValid: isWorkspaceConfigurationValid(workspace),
    provider: agentConfiguration.provider,
    providerOptionsValid: parsedProviderOptions.valid,
  });
  const canSave = saveBlocker === null;
  const duplicateAccount =
    configurationKind === "account" &&
    isDuplicateChannelAccount(existingAccounts, selectedConnection, accountId);

  const changeDestination = useCallback(
    (value: string | null) => setDestination(parseRouteDestination(value)),
    [setDestination],
  );
  const changes = useRouteBehaviorChanges(setBehavior, setApprovalChoice);
  const changeTarget = useCallback((value: string) => {
    targetChosen.current = true;
    setTarget(value as RouteTarget);
  }, []);
  const creator = useRouteAutomationCreator({
    createRouteAutomation,
    selectedConnection,
    setAutomationName,
    setTarget,
  });

  const submit = useCallback(async () => {
    if (!canSave || duplicateAccount) return;
    const routeTarget = formRouteTarget(existingTarget, {
      target,
      automationName,
      bot: routeBot.selected,
      leavesBot: routeBot.storedBot !== null,
      daemonId,
      projectId,
      cwd,
      worktree: worktreeTargetFromConfiguration(workspace),
      agentConfiguration,
      parsedProviderOptions,
    });
    if (routeTarget === null) return;
    const next = nextConfiguration({
      routeInput: {
        accountId: effectiveAccountId,
        audience: audienceRules.map(audienceRuleFromDraft),
        ...(parsedRouteLimits.valid ? { limits: parsedRouteLimits.value } : {}),
        behavior: behaviorWithApprovalChoice(behavior, approvalChoice),
        ...(conversation.parsed.valid ? { conversation: conversation.parsed.value } : {}),
        ...(toolActivity.parsed.valid && toolActivity.parsed.value !== undefined
          ? { toolActivity: toolActivity.parsed.value }
          : {}),
        target: routeTarget,
        resource,
      },
      existingAccounts,
      editing: isEditing ? editing : null,
      editedRoute,
      configurationKind,
      selectedConnection,
      selectedAccount,
    });
    if (next === null) return;
    const { nextAccounts, nextResource, nextRoute, createdAccountKey } = next;
    const review: RouteReviewInput = {
      warnings: warningsForRoute(
        await previewWarnings(nextAccounts, nextResource),
        nextAccounts,
        nextRoute,
      ),
      route: nextRoute,
      target:
        existingTarget === null
          ? routeTargetReviewLabel(target, automationName, routeBot.selected, agentConfiguration)
          : routeTargetSummary(existingTarget),
      audience: audienceRules.map((rule) => ruleSummary(rule, audienceNames, inheritedConditions)),
    };
    const confirmed = await confirmDialog({
      title: inputDraft
        ? t("hub.routes.review.useInputTitle")
        : routeConfirmationTitle(open, approvalChoice, isEditing),
      message: routeReviewMessage(review),
      body: routeReviewBody(review),
      confirmLabel: inputDraft
        ? t("hub.routes.review.useInput")
        : channelFormSubmitLabel(isEditing),
      destructive: open || approvalChoice === "auto-allow",
    });
    if (!confirmed || !mounted.current) return;
    save(nextAccounts, nextResource, createdAccountKey);
  }, [
    inputDraft,
    agentConfiguration,
    approvalChoice,
    audienceNames,
    audienceRules,
    inheritedConditions,
    automationName,
    behavior,
    canSave,
    confirmDialog,
    configurationKind,
    conversation.parsed,
    toolActivity.parsed,
    cwd,
    daemonId,
    duplicateAccount,
    editedRoute,
    editing,
    effectiveAccountId,
    existingAccounts,
    existingTarget,
    isEditing,
    mounted,
    open,
    parsedProviderOptions,
    parsedRouteLimits,
    projectId,
    resource,
    save,
    selectedAccount,
    selectedConnection,
    target,
    routeBot.selected,
    routeBot.storedBot,
    workspace,
    previewWarnings,
    t,
  ]);

  const renderAudience = () => (
    <RouteFormSection title={t("hub.routes.form.rules")} info={t("hub.routes.form.rulesInfo")}>
      {hubPredatesRules ? (
        <Alert
          variant="warning"
          title={t("hub.routes.form.predatesTitle")}
          description={t("hub.routes.form.predatesDescription")}
        />
      ) : null}
      <AudienceRulesEditor
        rules={audienceRules}
        setRules={setAudienceRules}
        people={rulePeople}
        channel={selectedConnection?.provider ?? stringField(selectedAccount, "channel")}
        observedChannel={observedAccountChannel}
        accountId={observedAccountId}
        names={audienceNames}
        inherited={inheritedConditions}
        routeLimits={parsedRouteLimits.valid ? parsedRouteLimits.value : NO_ROUTE_LIMITS}
        errors={audienceErrors}
        disabled={pending}
      />
    </RouteFormSection>
  );
  const renderConversation = () => (
    <RouteConversationSection
      draft={conversation.draft}
      parsed={conversation.parsed}
      commands={conversation.commands}
      showUnmentioned={audienceRules.some(
        (rule) =>
          rule.place === "groups" &&
          effectiveConditions(rule.conditions, inheritedConditions).requireMention,
      )}
      pending={pending}
    />
  );
  const renderReplies = () => (
    <RouteFormSection title={t("hub.routes.form.replies")}>
      <RouteReplyFields
        places={replyPlaces}
        behavior={replyBehavior}
        pending={pending}
        changeReplyThread={changes.changeReplyThread}
        changeDmReplyThread={changes.changeDmReplyThread}
        changeOutboundPath={changes.changeOutboundPath}
        changeFinalAnswers={changes.changeFinalAnswers}
        changeProgressMessage={changes.changeProgressMessage}
        changeTypingIndicator={changes.changeTypingIndicator}
        toolActivity={toolActivity}
      />
    </RouteFormSection>
  );
  // How the Agent runs belongs with what runs: its permissions, then its
  // provider settings folded under Advanced.
  const renderRunSettings = () => (
    <>
      {/* Its two fields carry their own labels; a heading over them would repeat them. */}
      <RoutePermissionFields
        approvalChoice={approvalChoice}
        questions={behavior.questions ?? DEFAULT_ROUTE_QUESTIONS}
        pending={pending}
        changeApprovalChoice={changes.changeApprovalChoice}
        changeQuestions={changes.changeQuestions}
      />
      {adminScoped || fixedAutomationName !== undefined || target !== "agent" ? null : (
        <FoldedRouteFormSubgroup
          title={t("hub.routes.form.advanced")}
          summary={t("hub.routes.form.advancedSummary")}
          inUse={
            initial.providerOptions.trim().length > 0 ||
            initial.agentConfiguration.featureValues["fast_mode"] === true
          }
        >
          <AgentAdvancedFields
            selectedDaemonServerId={selectedDaemonServerId}
            agentConfiguration={agentConfiguration}
            setAgentConfiguration={agent.setAgentConfiguration}
            providerOptions={providerOptions}
            parsedProviderOptions={parsedProviderOptions}
            setProviderOptions={agent.setProviderOptions}
            pending={pending}
          />
        </FoldedRouteFormSubgroup>
      )}
    </>
  );
  const renderTargetChoice = () => {
    if (fixedAutomationName !== undefined)
      return (
        <Text style={settingsStyles.rowTitle}>
          {t("hub.routes.review.automationTarget", { name: fixedAutomationName })}
        </Text>
      );
    if (adminScoped)
      return (
        <ChannelRouteAdminTarget
          editedRoute={editedRoute}
          routes={arrayField(selectedAccount ?? EMPTY_RECORD, "routes") as RecordValue[]}
          selectedIndex={existingTargetIndex}
          onChange={setExistingTargetIndex}
          disabled={pending}
        />
      );
    // The Bot's fields follow the choice; only one of the three targets shows its fields.
    return (
      <>
        <RouteTargetFields
          target={target}
          targetValues={channelRouteTargetValues(routeBot.offered || target === "bot")}
          changeTarget={changeTarget}
          automationName={automationName}
          automationDisplay={options.automationDisplay}
          automationOptions={options.automationOptions}
          setAutomationName={setAutomationName}
          automationCreatePending={creator.automationCreatePending}
          showAutomationCreator={creator.showAutomationCreator}
          showAutomationForm={creator.showAutomationForm}
          automationCreateError={creator.automationCreateError}
          daemonId={daemonId}
          daemonDisplay={options.daemonDisplay}
          daemonOptions={options.daemonOptions}
          changeDaemon={agent.changeDaemon}
          projectId={projectId}
          setProjectId={agent.setProjectId}
          cwd={cwd}
          setCwd={agent.setCwd}
          workspace={workspace}
          setWorkspace={agent.setWorkspace}
          selectedDaemonServerId={selectedDaemonServerId}
          agentConfiguration={agentConfiguration}
          setAgentConfiguration={agent.setAgentConfiguration}
          pending={pending}
        />
        {target === "bot" ? (
          <BotTargetFields
            options={routeBot.options}
            loading={routeBot.loading}
            selected={routeBot.selected}
            onChange={routeBot.setKey}
            launchChanged={routeBot.launchChanged}
            replacesRouteDefault={routeBot.replacesRouteDefault}
            pending={pending}
          />
        ) : null}
      </>
    );
  };
  const renderTarget = () => (
    <RouteFormSection
      title={t("hub.routes.form.whatRuns")}
      info={t("hub.routes.form.whatRunsInfo")}
    >
      {renderTargetChoice()}
      {renderRunSettings()}
    </RouteFormSection>
  );
  const renderAutomationCreator = () => {
    if (target !== "automation" || !creator.showAutomationCreator) return null;
    return (
      <SingleAgentAutomationForm
        key={selectedConnection?.provider}
        title={t("hub.routes.form.createAutomation")}
        channelReplyProvider={
          channelReplyProviderName(selectedConnection?.provider ?? null) ?? undefined
        }
        daemons={daemons}
        connections={automationConnections}
        existingNames={options.automationNames}
        pending={creator.automationCreatePending}
        cancel={creator.cancelAutomationCreate}
        save={creator.saveAutomation}
      />
    );
  };
  return (
    <View>
      <RouteConnectionSection
        fixedAccount={fixedAccount}
        account={isEditing ? editedAccount : selectedAccount}
        channelName={options.channelName}
        destinationValue={destinationValue}
        destinationDisplay={options.destinationDisplay}
        destinationOptions={options.destinationOptions}
        changeDestination={changeDestination}
        connectChannelAccount={connectChannelAccount}
        namesAccount={connectionStep.namesAccount}
        connectionId={connectionId}
        accountId={accountId}
        suggestedAccountId={suggestedAccountId}
        setAccountId={setAccountId}
        duplicateAccount={duplicateAccount}
        pending={pending}
      />
      {renderAudience()}
      {renderTarget()}
      {renderReplies()}
      <RouteLimitsSection
        draft={routeLimits}
        setDraft={setRouteLimits}
        parsed={parsedRouteLimits}
        names={routeLimitNames}
        inUse={initial.routeLimitsAuthored}
        pending={pending}
      />
      {renderConversation()}
      {target === "automation" && automationName !== null && !adminScoped ? (
        <AutomationReplyAuthority
          automation={automations.find((item) => item.name === automationName)}
          channel={selectedConnection?.provider}
        />
      ) : null}
      <View style={styles.formActions}>
        <Button disabled={pending || !canSave || duplicateAccount} onPress={submit}>
          {inputDraft ? t("hub.routes.review.useInput") : channelFormSubmitLabel(isEditing)}
        </Button>
        {/* A greyed button says nothing on its own: name the step it waits for. */}
        {saveBlocker === null || pending ? null : (
          <Text style={[settingsStyles.rowHint, styles.saveBlocker]}>{saveBlocker}</Text>
        )}
        <Button variant="ghost" disabled={pending} onPress={cancelEdit}>
          {t("hub.routes.common.cancel")}
        </Button>
      </View>
      {renderAutomationCreator()}
    </View>
  );
}

const NO_ROUTE_LIMITS: ChannelLimits = {};

const styles = StyleSheet.create((theme) => ({
  formActions: {
    gap: theme.spacing[2],
  },
  saveBlocker: {
    textAlign: "center",
  },
}));
