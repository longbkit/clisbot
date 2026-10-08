import { useCallback, useMemo, useState, type ComponentType } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { SelectField } from "@/components/ui/select-field";
import { useIsCompactFormFactor } from "@/constants/layout";
import { settingsStyles } from "@/styles/settings";
import {
  record,
  type AutomationWorkflowModel,
  type AutomationWorkflowState,
} from "../automation-workflow-model";
import { AutomationInputDraftContext, type AutomationChannelDraft } from "./automation-input-draft";
import { AutomationReplyNavigationContext } from "./automation-reply-navigation";
import type { AutomationConnection } from "./automation-settings";
import {
  inputLabel,
  inputSheetTitle,
  inputSourceOptions,
  routeSummary,
} from "./automation-workflow-labels";
import { workflowStyles as styles } from "./automation-workflow-styles";

type ChannelProvider = "slack" | "telegram";
export type ChannelInputsComponent = ComponentType<{ automationName: string; embedded?: boolean }>;

export interface WorkflowInputsProps {
  model: AutomationWorkflowModel;
  state: AutomationWorkflowState;
  pending: boolean;
  connections: AutomationConnection[];
  /**
   * False for a Member: Connection-sourced inputs (GitHub, Slack, Discord,
   * Linear) stay with Organization Admins, so Add input offers manual only.
   */
  allowConnectionInputs: boolean;
  ChannelInputs?: ChannelInputsComponent;
  channelDraft: AutomationChannelDraft | null;
  stageChannelDraft(value: AutomationChannelDraft): void;
  channelEditing: boolean;
  setChannelEditing(value: boolean): void;
  /** Opens the last step on its Result page, where reply grants live. */
  openReplies(): void;
}

export function WorkflowInputs(props: WorkflowInputsProps) {
  const { state, pending, ChannelInputs, channelDraft, channelEditing, openReplies } = props;
  const { t } = useTranslation();
  const [channelProvider, setChannelProvider] = useState<ChannelProvider | null>(null);
  const [selectedInput, setSelectedInput] = useState<string | null>(null);
  const [addingInput, setAddingInput] = useState(false);
  const name = String(state.value.name ?? "");
  const toggleAdding = useCallback(() => setAddingInput((value) => !value), []);
  const closeSheet = useCallback(() => {
    setAddingInput(false);
    setChannelProvider(null);
    setSelectedInput(null);
  }, []);
  const trailing = useMemo(
    () => (
      <Button
        size="sm"
        variant="outline"
        disabled={pending || channelEditing || !name.trim()}
        onPress={toggleAdding}
      >
        {t("hub.automations.form.addInput")}
      </Button>
    ),
    [channelEditing, name, pending, t, toggleAdding],
  );
  const events = Object.entries(record(state.value.on)).filter(
    ([event]) => event !== "channel.message",
  );
  return (
    <SettingsSection
      title={t("hub.automations.form.inputs")}
      prominence="primary"
      trailing={trailing}
    >
      <Text style={settingsStyles.rowHint}>{t("hub.automations.workflow.inputsHint")}</Text>
      {!channelDraft && ChannelInputs ? (
        <AutomationReplyNavigationContext.Provider value={openReplies}>
          <ChannelInputs automationName={String(state.value.name)} embedded />
        </AutomationReplyNavigationContext.Provider>
      ) : null}
      <DraftRouteRows
        draft={channelDraft}
        workflow={state.value.name}
        onEdit={setChannelProvider}
      />
      {addingInput || channelProvider || selectedInput ? (
        <InputSheet
          {...props}
          addingInput={addingInput}
          channelProvider={channelProvider}
          selectedInput={selectedInput}
          setAddingInput={setAddingInput}
          setChannelProvider={setChannelProvider}
          setSelectedInput={setSelectedInput}
          close={closeSheet}
        />
      ) : null}
      {events.map(([event, definition]) => (
        <EventInputRow
          key={event}
          event={event}
          connection={String(record(definition).connection ?? "")}
          pending={pending}
          onEdit={setSelectedInput}
        />
      ))}
    </SettingsSection>
  );
}

/** Channel Routes staged for this Automation before it exists; saved together with it. */
function DraftRouteRows({
  draft,
  workflow,
  onEdit,
}: {
  draft: AutomationChannelDraft | null;
  workflow: unknown;
  onEdit(provider: ChannelProvider): void;
}) {
  return (
    draft?.accounts.flatMap((account) =>
      (Array.isArray(account.routes) ? account.routes : [])
        .filter((route) => record(route).workflow === workflow)
        .map((route, index) => (
          <DraftRouteRow
            // oxlint-disable-next-line react/no-array-index-key -- a staged Route has no id until it is saved
            key={`${account.channel}:${account.accountId}:${index}`}
            channel={String(account.channel)}
            accountId={String(account.accountId)}
            route={record(route)}
            onEdit={onEdit}
          />
        )),
    ) ?? null
  );
}

function DraftRouteRow({
  channel,
  accountId,
  route,
  onEdit,
}: {
  channel: string;
  accountId: string;
  route: Record<string, unknown>;
  onEdit(provider: ChannelProvider): void;
}) {
  const { t } = useTranslation();
  const edit = useCallback(
    () => onEdit(channel === "telegram" ? "telegram" : "slack"),
    [channel, onEdit],
  );
  return (
    <View style={settingsStyles.row}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>
          {inputLabel(channel)} · {accountId}
        </Text>
        <Text style={settingsStyles.rowHint}>{routeSummary(route)}</Text>
      </View>
      <Button size="sm" variant="outline" onPress={edit}>
        {t("hub.automations.workflow.editInput")}
      </Button>
    </View>
  );
}

function EventInputRow({
  event,
  connection,
  pending,
  onEdit,
}: {
  event: string;
  connection: string;
  pending: boolean;
  onEdit(event: string): void;
}) {
  const { t } = useTranslation();
  const edit = useCallback(() => onEdit(event), [event, onEdit]);
  return (
    <View style={settingsStyles.row}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{inputLabel(event)}</Text>
        <Text style={settingsStyles.rowHint}>{connection}</Text>
      </View>
      <Button size="sm" variant="outline" disabled={pending} onPress={edit}>
        {t("hub.automations.workflow.editInput")}
      </Button>
    </View>
  );
}

function InputSheet({
  model,
  state,
  pending,
  connections,
  allowConnectionInputs,
  ChannelInputs,
  channelDraft,
  stageChannelDraft,
  channelEditing,
  setChannelEditing,
  addingInput,
  channelProvider,
  selectedInput,
  setAddingInput,
  setChannelProvider,
  setSelectedInput,
  close,
}: WorkflowInputsProps & {
  addingInput: boolean;
  channelProvider: ChannelProvider | null;
  selectedInput: string | null;
  setAddingInput(value: boolean): void;
  setChannelProvider(value: ChannelProvider | null): void;
  setSelectedInput(value: string | null): void;
  close(): void;
}) {
  const { t } = useTranslation();
  const header = useMemo(
    () => ({ title: inputSheetTitle(channelProvider, selectedInput) }),
    [channelProvider, selectedInput],
  );
  const closeUnlessEditing = useCallback(() => {
    if (!channelEditing) close();
  }, [channelEditing, close]);
  const footer = useMemo(
    () => (
      <Button disabled={channelEditing} onPress={close}>
        {t("hub.automations.workflow.done")}
      </Button>
    ),
    [channelEditing, close, t],
  );
  const draftContext = useMemo(
    () =>
      channelProvider
        ? {
            provider: channelProvider,
            draft: channelDraft,
            stage: stageChannelDraft,
            setEditing: setChannelEditing,
            pending,
          }
        : null,
    [channelDraft, channelProvider, pending, setChannelEditing, stageChannelDraft],
  );
  const chooseSource = useCallback(
    (value: string) => {
      if (value === "slack" || value === "telegram") setChannelProvider(value);
      else {
        model.set(["on", value], value === "manual.run" ? {} : { filters: { from_users: ["*"] } });
        setSelectedInput(value);
      }
      setAddingInput(false);
    },
    [model, setAddingInput, setChannelProvider, setSelectedInput],
  );
  const sourceOptions = useMemo(
    () =>
      inputSourceOptions(
        allowConnectionInputs,
        ChannelInputs !== undefined,
        record(state.value.on),
      ),
    [ChannelInputs, allowConnectionInputs, state.value.on],
  );
  const selected = Object.entries(record(state.value.on)).find(
    ([event]) => event === selectedInput,
  );
  return (
    <AdaptiveModalSheet
      contentStyle={styles.sheetContent}
      visible
      header={header}
      onClose={closeUnlessEditing}
      footer={footer}
    >
      {addingInput && !allowConnectionInputs ? (
        <Text style={settingsStyles.rowHint}>
          {t("hub.automations.workflow.connectionInputsNeedAdmin")}
        </Text>
      ) : null}
      {addingInput ? (
        <SelectField
          label={t("hub.automations.form.inputSource")}
          value={null}
          selectedDisplay={null}
          placeholder={t("hub.automations.workflow.chooseSource")}
          emptyText={t("hub.automations.workflow.noSources")}
          options={sourceOptions}
          onChange={chooseSource}
        />
      ) : null}
      {draftContext && ChannelInputs ? (
        <AutomationInputDraftContext.Provider value={draftContext}>
          <ChannelInputs automationName={String(state.value.name)} />
        </AutomationInputDraftContext.Provider>
      ) : null}
      {selected ? (
        <EventInputForm
          key={selected[0]}
          event={selected[0]}
          definition={record(selected[1])}
          model={model}
          connections={connections}
          pending={pending}
          onRemoved={setSelectedInput}
        />
      ) : null}
    </AdaptiveModalSheet>
  );
}

function EventInputForm({
  event,
  definition,
  model,
  connections,
  pending,
  onRemoved,
}: {
  event: string;
  definition: Record<string, unknown>;
  model: AutomationWorkflowModel;
  connections: AutomationConnection[];
  pending: boolean;
  onRemoved(selected: null): void;
}) {
  const { t } = useTranslation();
  const remove = useCallback(() => {
    model.set(["on", event], undefined);
    onRemoved(null);
    if (!Object.keys(record(model.getState().value.on)).length)
      model.set(["on", "channel.message"], { filters: { from_users: ["*"] } });
  }, [event, model, onRemoved]);
  return (
    <View style={styles.form}>
      <Text style={settingsStyles.rowTitle}>{inputLabel(event)}</Text>
      {event !== "manual.run" ? (
        <EventConnectionFields
          event={event}
          definition={definition}
          model={model}
          connections={connections}
          pending={pending}
        />
      ) : null}
      {event.startsWith("github.") ? (
        <RepositoryField event={event} definition={definition} model={model} pending={pending} />
      ) : null}
      <Button size="sm" variant="outline" disabled={pending} onPress={remove}>
        {t("hub.automations.inputEditor.remove")}
      </Button>
    </View>
  );
}

interface EventFieldProps {
  event: string;
  definition: Record<string, unknown>;
  model: AutomationWorkflowModel;
  pending: boolean;
}

function EventConnectionFields({
  event,
  definition,
  model,
  connections,
  pending,
}: EventFieldProps & { connections: AutomationConnection[] }) {
  const { t } = useTranslation();
  const size = useIsCompactFormFactor() ? "md" : "sm";
  const connection = definition.connection;
  const selectedConnection = useMemo(
    () => ({ label: String(connection ?? t("hub.automations.workflow.chooseConnection")) }),
    [connection, t],
  );
  const provider = event.split(".")[0];
  const options = useMemo(
    () =>
      connections
        .filter((entry) => entry.provider === provider)
        .map((entry) => ({
          id: entry.id,
          value: entry.name,
          label: entry.externalName ?? entry.name,
        })),
    [connections, provider],
  );
  const chooseConnection = useCallback(
    (value: string) => model.set(["on", event, "connection"], value),
    [event, model],
  );
  const changeUsers = useCallback(
    (value: string) =>
      model.set(
        ["on", event, "filters", "from_users"],
        value
          .split(",")
          .map((user) => user.trim())
          .filter(Boolean),
      ),
    [event, model],
  );
  const users = (record(definition.filters).from_users as string[]) ?? [];
  return (
    <>
      <SelectField
        label={t("hub.automations.eventEditor.connection")}
        value={String(connection ?? "")}
        selectedDisplay={selectedConnection}
        placeholder={t("hub.automations.workflow.chooseConnection")}
        emptyText={t("hub.automations.workflow.noConnections")}
        options={options}
        onChange={chooseConnection}
        disabled={pending}
      />
      <Field label={t("hub.automations.eventEditor.allowedUsers")}>
        <FormTextInput
          size={size}
          initialValue={users.join(", ")}
          onChangeText={changeUsers}
          editable={!pending}
        />
      </Field>
    </>
  );
}

function RepositoryField({ event, definition, model, pending }: EventFieldProps) {
  const { t } = useTranslation();
  const size = useIsCompactFormFactor() ? "md" : "sm";
  const changeRepository = useCallback(
    (value: string) => model.set(["on", event, "filters", "repo"], value || undefined),
    [event, model],
  );
  return (
    <Field label={t("hub.automations.eventEditor.repository")}>
      <FormTextInput
        size={size}
        initialValue={String(record(definition.filters).repo ?? "")}
        onChangeText={changeRepository}
        editable={!pending}
      />
    </Field>
  );
}
