import equal from "fast-deep-equal";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
} from "react";
import { Text, View } from "react-native";
import { Brain, Folder, FolderOpen, GitBranch } from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
import type { AgentProvider } from "@clisbot/protocol/agent-types";
import type { ScheduleCadence, ScheduleSummary } from "@clisbot/protocol/schedule/types";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { ComboboxItem } from "@/components/ui/combobox";
import { Button } from "@/components/ui/button";
import { CombinedModelSelector } from "@/components/combined-model-selector";
import { useIsCompactFormFactor } from "@/constants/layout";
import { HostPickerOption } from "@/components/hosts/host-picker";
import { createControlGeometry, type FieldControlSize } from "@/components/ui/control-geometry";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { Switch } from "@/components/ui/switch";
import { useProviderIcon } from "@/components/provider-icons";
// Clisbot: every N minutes or hours, daily, weekly or cron, with quick picks, in place of the
// upstream preset-plus-cron editor (same props).
import { CadencePicker as CadenceEditor } from "@/clisbot/schedules/cadence-picker";
import { MaxRunsField } from "@/clisbot/schedules/max-runs-field";
import { ScheduleRepeatRow, SCHEDULE_SHEET_WIDTH } from "@/clisbot/schedules/schedule-repeat-row";
import { missingMaxRuns, parseMaxRuns } from "@/clisbot/schedules/max-runs";
import { runLimitErrorForUpdate } from "@clisbot/protocol/schedule/run-limit";
import {
  SelectField,
  SelectFieldTrigger,
  type SelectFieldDisplay,
  type SelectFieldOption,
  type SelectFieldRenderOptionInput,
} from "@/components/ui/select-field";
import { formatThinkingOptionLabel } from "@/agent-controls/labels";
import {
  mergeProviderPreferences,
  useFormPreferences,
  type FormPreferences,
} from "@/hooks/use-form-preferences";
import { useScheduleMutations } from "@/hooks/use-schedule-mutations";
import { useAggregatedAgents } from "@/hooks/use-aggregated-agents";
import { useProjects } from "@/hooks/use-projects";
import { useHosts } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { buildScheduleProjectTargets } from "@/schedules/schedule-project-targets";
import { useScheduleFormModel } from "@/schedules/use-schedule-form-model";
import { useScheduleFormProviderSnapshot } from "@/schedules/use-schedule-form-provider-snapshot";
import type {
  ScheduleFormDisplay,
  ScheduleFormHost,
  ScheduleFormModel,
  ScheduleFormSnapshot,
  ScheduleFormState,
} from "@/schedules/schedule-form-model";
import { validateCron } from "@/utils/schedule-format";
import { toErrorMessage } from "@/utils/error-messages";
import { getDeviceTimeZone } from "@/utils/device-timezone";
import {
  RunInField,
  ScheduleSessionField,
  ExistingWorkspaceHint,
  ScheduleWorkspaceField,
  useScheduleChatId,
} from "@/clisbot/schedules/run-in-fields";
import { canManageSchedules } from "@/clisbot/schedules/use-schedule-detail";
import {
  ScheduleMentionsField,
  useScheduleMentions,
  type ScheduleMentions,
} from "@/clisbot/schedules/schedule-mentions-field";

export interface ScheduleFormSheetProps {
  serverId?: string;
  visible: boolean;
  onClose: () => void;
  mode: "create" | "edit";
  schedule?: ScheduleSummary;
  /** Create a heartbeat that runs in this session; Run in is fixed to it. */
  presetAgentId?: string;
}

type IsolationChoice = "local" | "worktree" | "existing";

const ISOLATION_LABELS: Record<IsolationChoice, string> = {
  local: "Local",
  worktree: "Worktree",
  existing: "Existing workspace",
};

/** Where each run's session lives when created: an existing workspace, or a new one and how. */
function newWorkspaceConfig(state: ScheduleFormState) {
  if (state.existingWorkspaceId) return { workspaceId: state.existingWorkspaceId };
  return {
    ...(state.submitArchiveOnFinish !== undefined
      ? { archiveOnFinish: state.submitArchiveOnFinish }
      : {}),
    ...(state.submitIsolation !== undefined ? { isolation: state.submitIsolation } : {}),
  };
}

/** Editing: set or clear the existing workspace, only where the host knows the field. */
function existingWorkspacePatch(state: ScheduleFormState) {
  return state.canUseExistingWorkspace ? { workspaceId: state.existingWorkspaceId || null } : {};
}

/** A project is chosen on a host whose daemon predates `config.workspaceId`. */
function needsHostForExistingWorkspace(state: ScheduleFormState): boolean {
  if (!state.disclosure.showProjectField || !state.workingDir) return false;
  const host = state.hosts.find((entry) => entry.serverId === state.selectedServerId);
  return host?.supportsExistingWorkspace !== true;
}

function submitLabel(mode: "create" | "edit", targetKind: ScheduleFormState["targetKind"]) {
  if (mode === "edit") return "Save changes";
  return targetKind === "agent" ? "Create heartbeat" : "Create schedule";
}

/**
 * What an edit changes of the cadence and Max runs. Only those answer to the Max runs rule, so a
 * schedule saved without Max runs before the rule can still be renamed or moved.
 */
function runLimitChange(
  state: ScheduleFormState,
  schedule: ScheduleSummary,
): { cadence?: NonNullable<ScheduleFormState["submitCadence"]>; maxRuns?: number | null } {
  const maxRuns = parseMaxRuns(state.maxRuns);
  return {
    ...(state.submitCadence && !equal(state.submitCadence, schedule.cadence)
      ? { cadence: state.submitCadence }
      : {}),
    ...(maxRuns !== (schedule.maxRuns ?? null) ? { maxRuns } : {}),
  };
}

/** The daemon would refuse the form: it repeats within the day and leaves Max runs empty. */
function missesMaxRuns(state: ScheduleFormState, schedule: ScheduleSummary | undefined): boolean {
  if (state.mode === "edit" && schedule) {
    return runLimitErrorForUpdate(schedule, runLimitChange(state, schedule)) !== null;
  }
  return missingMaxRuns(state.cadence, state.maxRuns);
}

function requireCronCadence(
  cadence: Extract<ScheduleCadence, { type: "cron" }> | undefined,
): Extract<ScheduleCadence, { type: "cron" }> {
  if (!cadence) {
    throw new Error("Choose a cron cadence before creating this schedule");
  }
  return cadence;
}

function resolveCreateServerId(input: {
  mode: "create" | "edit";
  serverId: string | null | undefined;
  hosts: readonly ScheduleFormHost[];
}): string | null {
  if (input.mode === "edit") {
    return input.serverId ?? null;
  }
  if (input.serverId !== undefined) {
    return input.serverId;
  }
  if (input.hosts.length === 1) {
    return input.hosts[0]?.serverId ?? null;
  }
  return null;
}

function buildScheduleHostOptionTestId(serverId: string): string {
  return `schedule-host-option-${serverId}`;
}

function buildThinkingOptionTestId(optionId: string): string {
  return `schedule-thinking-option-${optionId}`;
}

function openKey(props: ScheduleFormSheetProps): string {
  if (props.mode === "edit") {
    return `edit:${props.serverId ?? ""}:${props.schedule?.id ?? ""}`;
  }
  return `create:${props.serverId ?? ""}:${props.presetAgentId ?? ""}`;
}

function selectScheduleHosts(
  hosts: readonly { serverId: string; label: string }[],
  mode: "create" | "edit",
): (state: ReturnType<typeof useSessionStore.getState>) => ScheduleFormHost[] {
  return (state) =>
    hosts
      // Clisbot Managed Access: only hosts that grant `schedule.manage` take new schedules.
      .filter(
        (host) =>
          mode === "edit" ||
          canManageSchedules(state.sessions[host.serverId]?.serverInfo?.permissions),
      )
      .map((host) => ({
        serverId: host.serverId,
        label: host.label,
        supportsWorkspaceMultiplicity:
          state.sessions[host.serverId]?.serverInfo?.features?.workspaceMultiplicity === true,
        supportsExistingWorkspace:
          state.sessions[host.serverId]?.serverInfo?.features?.scheduleExistingWorkspace === true,
      }));
}

function buildSnapshot(input: {
  mode: "create" | "edit";
  serverId: string | undefined;
  schedule: ScheduleSummary | undefined;
  presetAgentId: string | undefined;
  hosts: readonly ScheduleFormHost[];
  projectTargets: ReturnType<typeof buildScheduleProjectTargets>;
  preferences: FormPreferences;
  timezone: string;
}): ScheduleFormSnapshot {
  const schedule = input.schedule
    ? { ...input.schedule, serverId: input.serverId, serverName: undefined }
    : undefined;
  return {
    mode: input.mode,
    schedule,
    ...(input.presetAgentId ? { presetAgentId: input.presetAgentId } : {}),
    hosts: input.hosts,
    defaults: {
      serverId: resolveCreateServerId({
        mode: input.mode,
        serverId: input.serverId,
        hosts: input.hosts,
      }),
      projectTargets: input.projectTargets,
      preferences: input.preferences,
      timezone: input.timezone,
    },
  };
}

function updateSelectionPreferences(input: {
  preferences: FormPreferences;
  provider: AgentProvider;
  model: string;
  mode: string;
  thinkingOptionId: string;
  isolation: "local" | "worktree";
}): FormPreferences {
  const model = input.model.trim();
  const mode = input.mode.trim();
  const thinkingOptionId = input.thinkingOptionId.trim();
  return {
    ...mergeProviderPreferences({
      preferences: input.preferences,
      provider: input.provider,
      updates: {
        model: model || undefined,
        mode: mode || undefined,
        ...(model && thinkingOptionId ? { thinkingByModel: { [model]: thinkingOptionId } } : {}),
      },
    }),
    isolation: input.isolation,
  };
}

export function ScheduleFormSheet(props: ScheduleFormSheetProps): ReactElement | null {
  const [renderedProps, setRenderedProps] = useState<ScheduleFormSheetProps | null>(() =>
    props.visible ? props : null,
  );
  const [sheetVisible, setSheetVisible] = useState(props.visible);
  const livePropsRef = useRef(props);
  const closeRequestedRef = useRef(false);
  livePropsRef.current = props;

  useEffect(() => {
    if (props.visible) {
      if (closeRequestedRef.current) {
        return;
      }
      setRenderedProps(props);
      setSheetVisible(true);
      return;
    }
    if (renderedProps) {
      setSheetVisible(false);
    }
  }, [props, renderedProps]);

  const requestClose = useCallback(() => {
    closeRequestedRef.current = true;
    setSheetVisible(false);
  }, []);

  const handleDismiss = useCallback(() => {
    const dismissedProps = livePropsRef.current;
    closeRequestedRef.current = false;
    setRenderedProps(null);
    setSheetVisible(false);
    if (dismissedProps.visible) {
      dismissedProps.onClose();
    }
  }, []);

  if (!renderedProps) {
    return null;
  }

  return (
    <OpenScheduleFormSheet
      key={openKey(renderedProps)}
      {...renderedProps}
      visible={sheetVisible}
      onClose={requestClose}
      onDismiss={handleDismiss}
    />
  );
}

function OpenScheduleFormSheet({
  serverId,
  visible,
  onClose,
  onDismiss,
  mode,
  schedule,
  presetAgentId,
}: ScheduleFormSheetProps & { onDismiss: () => void }): ReactElement {
  const controlSize: FieldControlSize = useIsCompactFormFactor() ? "md" : "sm";
  const { projects } = useProjects();
  const hostProfiles = useHosts();
  const hosts = useStoreWithEqualityFn(
    useSessionStore,
    useMemo(() => selectScheduleHosts(hostProfiles, mode), [hostProfiles, mode]),
    equal,
  );
  const { preferences, updatePreferences } = useFormPreferences();
  const projectTargets = useMemo(() => buildScheduleProjectTargets(projects), [projects]);
  const timezone = useMemo(getDeviceTimeZone, []);
  const snapshot = useMemo(
    () =>
      buildSnapshot({
        mode,
        serverId,
        schedule,
        presetAgentId,
        hosts,
        projectTargets,
        preferences,
        timezone,
      }),
    [hosts, mode, preferences, presetAgentId, projectTargets, schedule, serverId, timezone],
  );
  const model = useScheduleFormModel(snapshot);
  const state = useSyncExternalStore(model.subscribe, model.getState, model.getState);
  const providerSnapshot = useScheduleFormProviderSnapshot(model, state);
  const { agents } = useAggregatedAgents({ includeArchived: true });
  const mutationServerId = state.selectedServerId ?? serverId ?? "";
  const { createSchedule, updateSchedule, isCreating, isUpdating } = useScheduleMutations({
    serverId: mutationServerId,
  });

  const isSubmitting = isCreating || isUpdating;
  const cadenceError =
    state.cadence.type === "cron" ? validateCron(state.cadence.expression) : null;
  const chatId = useScheduleChatId(state.selectedServerId, state.targetAgentId);
  const mentions = useScheduleMentions(state.selectedServerId, state.targetAgentId, chatId);
  const canSubmit =
    state.canSubmit &&
    cadenceError === null &&
    !isSubmitting &&
    !(mentions.options.length > 0 && mentions.value.length === 0) &&
    !missesMaxRuns(state, schedule);
  const agentTargetLabel = useMemo(() => {
    if (!schedule || schedule.target.type !== "agent") {
      return null;
    }
    const { agentId } = schedule.target;
    const agent = agents.find(
      (entry) => entry.serverId === (state.selectedServerId ?? serverId) && entry.id === agentId,
    );
    if (!agent) {
      return "Agent unavailable";
    }
    return agent.title?.trim() || "Untitled agent";
  }, [agents, schedule, serverId, state.selectedServerId]);

  const persistPreferences = useCallback(async () => {
    const provider = state.selectedProvider;
    if (!provider) {
      return;
    }
    await updatePreferences((current) =>
      updateSelectionPreferences({
        preferences: current,
        provider,
        model: state.selectedModel,
        mode: state.selectedMode,
        thinkingOptionId: state.selectedThinkingOptionId,
        isolation: state.isolation,
      }),
    );
  }, [
    state.isolation,
    state.selectedMode,
    state.selectedModel,
    state.selectedProvider,
    state.selectedThinkingOptionId,
    updatePreferences,
  ]);

  const submitAgentTarget = useCallback(async (): Promise<boolean> => {
    if (!state.submitCadence) {
      return false;
    }
    if (mode === "create") {
      if (!state.targetAgentId) {
        return false;
      }
      const maxRuns = parseMaxRuns(state.maxRuns);
      await createSchedule({
        prompt: state.prompt.trim(),
        name: state.name.trim() || undefined,
        cadence: state.submitCadence,
        target: {
          type: "agent",
          agentId: state.targetAgentId,
          ...(chatId ? { chatId } : {}),
          ...(chatId && mentions.options.length > 0 ? { mentionBotIds: mentions.value } : {}),
        },
        ...(maxRuns != null ? { maxRuns } : {}),
      });
      return true;
    }
    if (!schedule) {
      return false;
    }
    await updateSchedule({ id: schedule.id, ...runLimitChange(state, schedule) });
    return true;
  }, [chatId, createSchedule, mentions, mode, schedule, state, updateSchedule]);

  const submitNewAgent = useCallback(async (): Promise<boolean> => {
    const provider = state.selectedProvider;
    const cwd = state.workingDir.trim();
    if (!provider || !cwd) {
      return false;
    }

    await persistPreferences();
    const maxRuns = parseMaxRuns(state.maxRuns);
    if (mode === "edit" && schedule) {
      await updateSchedule({
        id: schedule.id,
        name: state.name.trim() || null,
        prompt: state.prompt.trim(),
        ...runLimitChange(state, schedule),
        newAgentConfig: {
          provider,
          model: state.selectedModel || null,
          modeId: state.selectedMode || null,
          thinkingOptionId: state.selectedThinkingOptionId || null,
          cwd,
          ...(state.submitArchiveOnFinish !== undefined
            ? { archiveOnFinish: state.submitArchiveOnFinish }
            : {}),
          ...(state.submitIsolation !== undefined ? { isolation: state.submitIsolation } : {}),
          ...existingWorkspacePatch(state),
        },
      });
      return true;
    }

    await createSchedule({
      prompt: state.prompt.trim(),
      name: state.name.trim() || undefined,
      cadence: requireCronCadence(state.submitCadence),
      target: {
        type: "new-agent",
        config: {
          provider,
          cwd,
          model: state.selectedModel || undefined,
          modeId: state.selectedMode || undefined,
          thinkingOptionId: state.selectedThinkingOptionId || undefined,
          ...newWorkspaceConfig(state),
          title: state.name.trim() || undefined,
        },
      },
      ...(maxRuns != null ? { maxRuns } : {}),
    });
    return true;
  }, [createSchedule, mode, persistPreferences, schedule, state, updateSchedule]);

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) {
      return;
    }
    model.setSubmitError(null);
    try {
      const submitted =
        state.targetKind === "agent" ? await submitAgentTarget() : await submitNewAgent();
      if (submitted) {
        onClose();
      }
    } catch (error) {
      model.setSubmitError(toErrorMessage(error));
    }
  }, [canSubmit, model, onClose, state.targetKind, submitAgentTarget, submitNewAgent]);

  const handleSubmitPress = useCallback(() => {
    void handleSubmit();
  }, [handleSubmit]);

  const header = useMemo<SheetHeader>(() => {
    if (mode !== "edit") {
      return { title: state.targetKind === "agent" ? "New heartbeat" : "New schedule" };
    }
    return { title: schedule?.target.type === "agent" ? "Edit heartbeat" : "Edit schedule" };
  }, [mode, schedule?.target.type, state.targetKind]);

  const footer = useMemo(
    () => (
      <View style={styles.footer}>
        <Button
          style={styles.footerButton}
          variant="secondary"
          onPress={onClose}
          disabled={isSubmitting}
        >
          Cancel
        </Button>
        <Button
          style={styles.footerButton}
          variant="default"
          onPress={handleSubmitPress}
          disabled={!canSubmit}
          loading={isSubmitting}
          testID="schedule-form-submit"
        >
          {submitLabel(mode, state.targetKind)}
        </Button>
      </View>
    ),
    [canSubmit, handleSubmitPress, isSubmitting, mode, onClose, state.targetKind],
  );

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={onClose}
      onDismiss={onDismiss}
      footer={footer}
      desktopMaxWidth={SCHEDULE_SHEET_WIDTH}
      testID="schedule-form-sheet"
    >
      <ScheduleFormFields
        model={model}
        state={state}
        providerSnapshot={providerSnapshot}
        agentTargetLabel={agentTargetLabel}
        controlSize={controlSize}
        cadenceError={cadenceError}
        mutationServerId={mutationServerId}
        mentions={mentions}
      />
    </AdaptiveModalSheet>
  );
}

interface ScheduleFormFieldsProps {
  model: ScheduleFormModel;
  state: ScheduleFormState;
  providerSnapshot: ReturnType<typeof useScheduleFormProviderSnapshot>;
  agentTargetLabel: string | null;
  controlSize: FieldControlSize;
  cadenceError: string | null;
  mutationServerId: string;
  mentions: ScheduleMentions;
}

function ScheduleFormFields({
  model,
  state,
  providerSnapshot,
  agentTargetLabel,
  controlSize,
  cadenceError,
  mutationServerId,
  mentions,
}: ScheduleFormFieldsProps): ReactElement {
  if (state.targetKind === "agent" && state.mode === "create") {
    return (
      <HeartbeatCreateFields
        model={model}
        state={state}
        controlSize={controlSize}
        cadenceError={cadenceError}
        mentions={mentions}
      />
    );
  }
  if (state.targetKind === "agent") {
    return (
      <>
        <ScheduleAgentTargetField label={agentTargetLabel} size={controlSize} />
        <ScheduleRepeatRow>
          <CadenceEditor
            value={state.cadence}
            onChange={model.setCadence}
            error={cadenceError ?? undefined}
            size={controlSize}
          />
          <MaxRunsField
            cadence={state.cadence}
            value={state.maxRuns}
            onChange={model.setMaxRuns}
            size={controlSize}
            testID="schedule-max-runs-input"
          />
        </ScheduleRepeatRow>
        {state.submitError ? <Text style={styles.submitError}>{state.submitError}</Text> : null}
      </>
    );
  }

  return (
    <>
      {state.targetKindLocked ? null : (
        <RunInField value={state.targetKind} onChange={model.setTargetKind} size={controlSize} />
      )}
      <Field label="Name">
        <FormTextInput
          size={controlSize}
          testID="schedule-name-input"
          accessibilityLabel="Schedule name"
          initialValue={state.name}
          onChangeText={model.setName}
          placeholder="Optional"
          autoCapitalize="none"
          autoCorrect={false}
        />
      </Field>

      <Field label="Prompt">
        <FormTextInput
          size={controlSize}
          testID="schedule-prompt-input"
          accessibilityLabel="Prompt"
          initialValue={state.prompt}
          onChangeText={model.setPrompt}
          placeholder="What should the agent do each run?"
          style={styles.multilineInput}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
        />
      </Field>

      <ScheduleTargetFields
        model={model}
        state={state}
        providerSnapshot={providerSnapshot}
        agentTargetLabel={null}
        controlSize={controlSize}
        mutationServerId={mutationServerId}
      />

      <ScheduleRepeatRow>
        <CadenceEditor
          value={state.cadence}
          onChange={model.setCadence}
          error={cadenceError ?? undefined}
          size={controlSize}
        />
        <MaxRunsField
          cadence={state.cadence}
          value={state.maxRuns}
          onChange={model.setMaxRuns}
          size={controlSize}
          testID="schedule-max-runs-input"
        />
      </ScheduleRepeatRow>

      {state.submitError ? <Text style={styles.submitError}>{state.submitError}</Text> : null}
    </>
  );
}

/** Creating a heartbeat: the session it runs in, then what to send and how often. */
function HeartbeatCreateFields({
  model,
  state,
  controlSize,
  cadenceError,
  mentions,
}: {
  model: ScheduleFormModel;
  state: ScheduleFormState;
  controlSize: FieldControlSize;
  cadenceError: string | null;
  mentions: ScheduleMentions;
}): ReactElement {
  const hostOptions = useMemo<SelectFieldOption<string>[]>(
    () =>
      state.hosts.map((host) => ({
        id: host.serverId,
        value: host.serverId,
        label: host.label,
        testID: buildScheduleHostOptionTestId(host.serverId),
      })),
    [state.hosts],
  );
  const selectedHost = state.hosts.find((host) => host.serverId === state.selectedServerId);
  const selectedHostDisplay = useMemo(
    () => (selectedHost ? { label: selectedHost.label } : null),
    [selectedHost],
  );
  const handleSelectSession = useCallback(
    (agentId: string) => model.setTargetAgent(agentId),
    [model],
  );
  const renderHostOption = useCallback(
    (input: SelectFieldRenderOptionInput<string>) => <HostOptionItem {...input} />,
    [],
  );
  return (
    <>
      {state.targetKindLocked ? null : (
        <RunInField value={state.targetKind} onChange={model.setTargetKind} size={controlSize} />
      )}
      {!state.targetKindLocked && state.hosts.length > 1 ? (
        <SelectField
          label="Host"
          value={state.selectedServerId}
          selectedDisplay={selectedHostDisplay}
          options={hostOptions}
          onChange={model.setHost}
          placeholder="Select host"
          emptyText="No hosts found"
          searchable
          searchPlaceholder="Search by name or ID"
          title="Host"
          size={controlSize}
          triggerTestID="schedule-host-trigger"
          renderOption={renderHostOption}
        />
      ) : null}
      <ScheduleSessionField
        serverId={state.selectedServerId}
        agentId={state.targetAgentId}
        locked={state.targetKindLocked}
        onChange={handleSelectSession}
        size={controlSize}
      />
      <ScheduleMentionsField mentions={mentions} />
      <Field label="Name">
        <FormTextInput
          size={controlSize}
          testID="schedule-name-input"
          accessibilityLabel="Heartbeat name"
          initialValue={state.name}
          onChangeText={model.setName}
          placeholder="Optional"
          autoCapitalize="none"
          autoCorrect={false}
        />
      </Field>
      <Field label="Prompt">
        <FormTextInput
          size={controlSize}
          testID="schedule-prompt-input"
          accessibilityLabel="Prompt"
          initialValue={state.prompt}
          onChangeText={model.setPrompt}
          placeholder="What should the session do each run?"
          style={styles.multilineInput}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
        />
      </Field>
      <ScheduleRepeatRow>
        <CadenceEditor
          value={state.cadence}
          onChange={model.setCadence}
          error={cadenceError ?? undefined}
          size={controlSize}
        />
        <MaxRunsField
          cadence={state.cadence}
          value={state.maxRuns}
          onChange={model.setMaxRuns}
          size={controlSize}
          testID="schedule-max-runs-input"
        />
      </ScheduleRepeatRow>
      {state.submitError ? <Text style={styles.submitError}>{state.submitError}</Text> : null}
    </>
  );
}

interface ScheduleTargetFieldsProps {
  model: ScheduleFormModel;
  state: ScheduleFormState;
  providerSnapshot: ReturnType<typeof useScheduleFormProviderSnapshot>;
  agentTargetLabel: string | null;
  controlSize: FieldControlSize;
  mutationServerId: string;
}

function ScheduleTargetFields({
  model,
  state,
  providerSnapshot,
  agentTargetLabel,
  controlSize,
  mutationServerId,
}: ScheduleTargetFieldsProps): ReactElement {
  const hostOptions = useMemo<SelectFieldOption<string>[]>(
    () =>
      state.hosts.map((host) => ({
        id: host.serverId,
        value: host.serverId,
        label: host.label,
        testID: buildScheduleHostOptionTestId(host.serverId),
      })),
    [state.hosts],
  );
  const selectedHost = state.hosts.find((host) => host.serverId === state.selectedServerId) ?? null;
  const selectedHostDisplay = useMemo<SelectFieldDisplay | null>(() => {
    if (selectedHost) {
      return { label: selectedHost.label };
    }
    if (state.selectedServerId) {
      return { label: state.selectedServerId };
    }
    return null;
  }, [selectedHost, state.selectedServerId]);
  const projectOptions = state.projectOptions;
  const modeOptions = useMemo<SelectFieldOption<string>[]>(
    () =>
      state.modeOptions.map((option) => ({
        id: option.id,
        value: option.id,
        label: option.label,
      })),
    [state.modeOptions],
  );
  const thinkingOptions = useMemo<SelectFieldOption<string>[]>(
    () =>
      state.availableThinkingOptions.map((option) => ({
        id: option.id,
        value: option.id,
        label: formatThinkingOptionLabel(option),
        testID: buildThinkingOptionTestId(option.id),
      })),
    [state.availableThinkingOptions],
  );
  const handleSelectHost = useCallback(
    (nextServerId: string) => {
      model.setHost(nextServerId);
    },
    [model],
  );
  const handleSelectProject = useCallback(
    (optionId: string, display: ScheduleFormDisplay) => {
      model.setProject(optionId, display);
    },
    [model],
  );
  const handleSelectModel = useCallback(
    (provider: AgentProvider, modelId: string) => {
      model.setModel(provider, modelId);
    },
    [model],
  );
  const handleSelectMode = useCallback(
    (modeId: string) => {
      model.setSessionMode(modeId);
    },
    [model],
  );
  const handleSelectThinking = useCallback(
    (thinkingOptionId: string) => {
      model.setThinking(thinkingOptionId);
    },
    [model],
  );
  const handleModelOpen = useCallback(() => {
    providerSnapshot.refetchIfStale(state.selectedProvider);
  }, [providerSnapshot, state.selectedProvider]);
  const handleRetryProvider = useCallback(
    (provider: AgentProvider) => {
      void providerSnapshot.refresh([provider]);
    },
    [providerSnapshot],
  );
  const renderHostOption = useCallback(
    (input: SelectFieldRenderOptionInput<string>) => <HostOptionItem {...input} />,
    [],
  );
  const renderProjectOption = useCallback(
    (input: SelectFieldRenderOptionInput<string>) => <ProjectOptionItem {...input} />,
    [],
  );
  const renderThinkingOption = useCallback(
    (input: SelectFieldRenderOptionInput<string>) => <ThinkingOptionItem {...input} />,
    [],
  );
  const modelTriggerLeading = useMemo(
    () => <ProviderGlyph provider={state.selectedProvider} serverId={state.selectedServerId} />,
    [state.selectedProvider, state.selectedServerId],
  );
  const renderModelTrigger = useCallback(
    ({
      selectedModelLabel,
      disabled,
      isOpen,
      hovered,
      pressed,
    }: {
      selectedModelLabel: string;
      onPress: () => void;
      disabled: boolean;
      isOpen: boolean;
      hovered: boolean;
      pressed: boolean;
    }): ReactNode => {
      const displayLabel = state.selectedModelDisplay?.label ?? selectedModelLabel;
      return (
        <SelectFieldTrigger
          label={displayLabel}
          isPlaceholder={!state.selectedModel}
          placeholder={displayLabel}
          leading={modelTriggerLeading}
          disabled={disabled}
          active={hovered || pressed || isOpen}
          size={controlSize}
          testID="schedule-model-trigger"
        />
      );
    },
    [controlSize, modelTriggerLeading, state.selectedModel, state.selectedModelDisplay],
  );

  if (state.targetKind === "agent") {
    return <ScheduleAgentTargetField label={agentTargetLabel} size={controlSize} />;
  }

  return (
    <>
      {state.mode === "edit" || state.hosts.length > 1 ? (
        <SelectField
          label="Host"
          value={state.selectedServerId}
          selectedDisplay={selectedHostDisplay}
          options={hostOptions}
          onChange={handleSelectHost}
          placeholder="Select host"
          emptyText="No hosts found"
          disabled={state.mode === "edit"}
          searchable
          searchPlaceholder="Search by name or ID"
          title="Host"
          size={controlSize}
          triggerTestID="schedule-host-trigger"
          renderOption={renderHostOption}
        />
      ) : null}

      {state.disclosure.showProjectField ? (
        <SelectField
          label="Project"
          value={state.selectedProjectOptionId || null}
          selectedDisplay={state.projectDisplay}
          options={projectOptions}
          onChange={handleSelectProject}
          placeholder="Select project"
          emptyText="No projects found"
          disabled={!state.selectedServerId}
          hint={!state.selectedServerId ? "Choose a host first." : undefined}
          searchable
          searchPlaceholder="Search projects..."
          title="Select project"
          size={controlSize}
          triggerTestID="schedule-project-trigger"
          renderOption={renderProjectOption}
        />
      ) : null}

      {state.disclosure.showModelField ? (
        <Field label="Model">
          <CombinedModelSelector
            providers={state.modelSelectorProviders}
            selectedProvider={state.selectedProvider ?? ""}
            selectedModel={state.selectedModel}
            onSelect={handleSelectModel}
            isLoading={providerSnapshot.isLoading || providerSnapshot.isFetching}
            renderTrigger={renderModelTrigger}
            triggerFill
            serverId={mutationServerId}
            disabled={!state.selectedServerId}
            onOpen={handleModelOpen}
            onRetryProvider={handleRetryProvider}
            isRetryingProvider={providerSnapshot.isRefreshing}
          />
        </Field>
      ) : null}

      {state.disclosure.showThinkingField ? (
        <SelectField
          label="Thinking"
          value={state.selectedThinkingOptionId || null}
          selectedDisplay={state.selectedThinkingDisplay}
          options={thinkingOptions}
          onChange={handleSelectThinking}
          placeholder="Select thinking"
          emptyText="No thinking options found"
          searchable={thinkingOptions.length > 6}
          title="Select thinking"
          size={controlSize}
          triggerTestID="schedule-thinking-trigger"
          renderOption={renderThinkingOption}
        />
      ) : null}

      {state.disclosure.showModeField ? (
        <SelectField
          label="Mode"
          value={state.selectedMode || null}
          selectedDisplay={state.selectedModeDisplay}
          options={modeOptions}
          onChange={handleSelectMode}
          placeholder="Default mode"
          emptyText="No modes found"
          disabled={modeOptions.length === 0}
          hint={modeOptions.length === 0 ? "No modes are available for this model." : undefined}
          searchable={modeOptions.length > 6}
          title="Select mode"
          size={controlSize}
          triggerTestID="schedule-mode-trigger"
        />
      ) : null}

      {state.disclosure.showIsolationField ? (
        <ScheduleIsolationField model={model} state={state} size={controlSize} />
      ) : null}

      <ExistingWorkspaceHint visible={needsHostForExistingWorkspace(state)} />

      {state.disclosure.showIsolationField && state.existingWorkspaceId !== null ? (
        <ScheduleWorkspaceField
          serverId={state.selectedServerId}
          projectViewKey={state.selectedProjectViewKey}
          workspaceId={state.existingWorkspaceId}
          onChange={model.setExistingWorkspace}
          size={controlSize}
        />
      ) : null}

      {state.disclosure.showArchiveOnFinishField ? (
        <Field label="Archive on finish">
          <Switch
            value={state.archiveOnFinish}
            onValueChange={model.setArchiveOnFinish}
            accessibilityLabel="Archive on finish"
            testID="schedule-archive-on-finish-switch"
          />
        </Field>
      ) : null}
    </>
  );
}

function ScheduleIsolationField({
  model,
  state,
  size,
}: {
  model: ScheduleFormModel;
  state: ScheduleFormState;
  size: FieldControlSize;
}): ReactElement {
  const options = useMemo<SelectFieldOption<IsolationChoice>[]>(
    () => [
      {
        id: "local",
        value: "local",
        label: "Local",
        testID: "schedule-isolation-local",
      },
      ...(state.canUseWorktreeIsolation
        ? [
            {
              id: "worktree",
              value: "worktree" as const,
              label: "Worktree",
              testID: "schedule-isolation-worktree",
            },
          ]
        : []),
      ...(state.canUseExistingWorkspace
        ? [
            {
              id: "existing",
              value: "existing" as const,
              label: "Existing workspace",
              testID: "schedule-isolation-existing",
            },
          ]
        : []),
    ],
    [state.canUseExistingWorkspace, state.canUseWorktreeIsolation],
  );
  const choice: IsolationChoice =
    state.existingWorkspaceId !== null ? "existing" : state.effectiveIsolation;
  const selectedDisplay = useMemo<SelectFieldDisplay>(
    () => ({ label: ISOLATION_LABELS[choice] }),
    [choice],
  );
  const triggerLeading = useMemo(
    () => (
      <View style={styles.optionIconBox}>
        <IsolationIcon value={choice} />
      </View>
    ),
    [choice],
  );
  const handleSelectIsolation = useCallback(
    (value: IsolationChoice) => {
      if (value === "existing") {
        model.setExistingWorkspace(state.existingWorkspaceId ?? "");
        return;
      }
      model.setExistingWorkspace(null);
      model.setIsolation(value);
    },
    [model, state.existingWorkspaceId],
  );
  const renderIsolationOption = useCallback(
    (input: SelectFieldRenderOptionInput<IsolationChoice>) => <IsolationOptionItem {...input} />,
    [],
  );

  return (
    <SelectField
      label="Isolation"
      value={choice}
      selectedDisplay={selectedDisplay}
      options={options}
      onChange={handleSelectIsolation}
      placeholder="Select isolation"
      emptyText="No isolation options found"
      searchable={false}
      title="Isolation"
      size={size}
      testID="schedule-isolation"
      triggerTestID="schedule-isolation-trigger"
      triggerLeading={triggerLeading}
      renderOption={renderIsolationOption}
    />
  );
}

function ScheduleAgentTargetField({
  label,
  size,
}: {
  label: string | null;
  size: FieldControlSize;
}): ReactElement {
  const fieldStyle = useMemo(
    () => [styles.readonlyField, size === "sm" ? styles.readonlyFieldSm : styles.readonlyFieldMd],
    [size],
  );
  const textStyle = useMemo(
    () => [styles.readonlyText, size === "sm" ? styles.readonlyTextSm : styles.readonlyTextMd],
    [size],
  );

  return (
    <Field label="Target">
      <View style={fieldStyle} testID="schedule-agent-target">
        <Text style={textStyle} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </Field>
  );
}

function IsolationIcon({ value }: { value: IsolationChoice }): ReactElement {
  if (value === "worktree") return <GitBranch size={16} color={styles.providerIcon.color} />;
  if (value === "existing") return <FolderOpen size={16} color={styles.providerIcon.color} />;
  return <Folder size={16} color={styles.providerIcon.color} />;
}

function IsolationOptionItem({
  option,
  selected,
  active,
  onPress,
}: SelectFieldRenderOptionInput<IsolationChoice>): ReactElement {
  const leadingSlot = useMemo(
    () => (
      <View style={styles.optionIconBox}>
        <IsolationIcon value={option.value} />
      </View>
    ),
    [option.value],
  );

  return (
    <ComboboxItem
      testID={option.testID}
      label={option.label}
      selected={selected}
      active={active}
      onPress={onPress}
      leadingSlot={leadingSlot}
    />
  );
}

// Clisbot: the app's standard host row (status, Host ID, connection), as in the host pickers.
function HostOptionItem({
  option,
  selected,
  active,
  onPress,
}: SelectFieldRenderOptionInput<string>): ReactElement {
  return (
    <HostPickerOption
      serverId={option.value}
      label={option.label}
      showActiveConnection
      selected={selected}
      active={active}
      onPress={onPress}
      testID={option.testID}
    />
  );
}

function ProjectOptionItem({
  option,
  selected,
  active,
  onPress,
}: SelectFieldRenderOptionInput<string>): ReactElement {
  const leadingSlot = useMemo(
    () => (
      <View style={styles.optionIconBox}>
        <Folder size={16} color={styles.providerIcon.color} />
      </View>
    ),
    [],
  );

  return (
    <ComboboxItem
      testID={option.testID}
      label={option.label}
      selected={selected}
      active={active}
      onPress={onPress}
      leadingSlot={leadingSlot}
    />
  );
}

function ThinkingOptionItem({
  option,
  selected,
  active,
  onPress,
}: SelectFieldRenderOptionInput<string>): ReactElement {
  const leadingSlot = useMemo(
    () => (
      <View style={styles.optionIconBox}>
        <Brain size={16} color={styles.providerIcon.color} />
      </View>
    ),
    [],
  );

  return (
    <ComboboxItem
      testID={option.testID}
      label={option.label}
      selected={selected}
      active={active}
      onPress={onPress}
      leadingSlot={leadingSlot}
    />
  );
}

function ProviderGlyph({
  provider,
  serverId,
}: {
  provider: string | null;
  serverId: string | null;
}): ReactElement | null {
  const Icon = useProviderIcon(provider ?? "", serverId);
  if (!provider) {
    return null;
  }
  return <Icon size={16} color={styles.providerIcon.color} />;
}

const styles = StyleSheet.create((theme) => {
  const geometry = createControlGeometry(theme);

  return {
    multilineInput: {
      minHeight: 96,
    },
    readonlyField: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: theme.colors.surface2,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    readonlyFieldSm: {
      ...geometry.formTextInputSm,
    },
    readonlyFieldMd: {
      ...geometry.formTextInputMd,
    },
    readonlyText: {
      flex: 1,
      minWidth: 0,
      color: theme.colors.foreground,
    },
    readonlyTextSm: {
      fontSize: theme.fontSize.base,
    },
    readonlyTextMd: {
      fontSize: theme.fontSize.base,
    },
    optionIconBox: {
      width: 18,
      height: 18,
      alignItems: "center",
      justifyContent: "center",
    },
    footer: {
      flex: 1,
      flexDirection: "row",
      gap: theme.spacing[3],
    },
    footerButton: {
      flex: 1,
    },
    submitError: {
      color: theme.colors.palette.red[300],
      fontSize: theme.fontSize.sm,
    },
    providerIcon: {
      color: theme.colors.foregroundMuted,
    },
  };
});
