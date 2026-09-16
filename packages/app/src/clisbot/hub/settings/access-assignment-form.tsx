import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/form-field";
import { SelectField, type SelectFieldOption } from "@/components/ui/select-field";
import { Switch } from "@/components/ui/switch";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { ConversationSelectionFields } from "./conversation-picker-field";
import { accessConstraintDraft } from "./access-assignment-edit";
import { useMountedAccessScope } from "./access-mounted-scope";
import {
  resolveAssignmentSelection,
  type AssignmentSelection,
} from "./access-assignment-selection";
import { submitAccessAssignment } from "./access-assignment-submit";
import {
  assignmentResourceOptions,
  assignmentSubjectOptions,
  conversationLabel,
  resourceKey,
  selectedOptionDisplay,
  subjectKey,
  type AccessAssignment,
  type AccessCatalog,
  type AccessResource,
  type HubMember,
  type HubTeam,
} from "./access-catalog";
import { accessSettingsStyles as styles } from "./access-settings-styles";
import { MultiSelectField, type MultiSelection } from "./multi-select-field";
import {
  AgentConfigurationGrantEditor,
  agentConfigurationDraftFrom,
  createAgentConfigurationDraft,
  type AgentConfigurationDraft,
} from "./agent-configuration-grant-fields";

const CONVERSATION_OPTIONS: SelectFieldOption<string>[] = [
  { id: "specific", value: "specific", label: "Specific conversations" },
  { id: "direct_messages", value: "direct_messages", label: "Direct messages" },
  {
    id: "public_channels",
    value: "public_channels",
    label: "Public conversations",
  },
  { id: "all", value: "all", label: "All conversations" },
];

export function GrantAccessContent({
  initialSubject,
  initialResource,
  editing,
  cancelEdit,
  assignableSubjects,
  catalog,
  assignments,
  members,
  teams,
  pending,
  save,
}: {
  editing: AccessAssignment | null;
  cancelEdit(): void;
  initialSubject: string | null;
  initialResource: string | null;
  assignableSubjects: number;
  catalog: AccessCatalog;
  assignments: AccessAssignment[];
  members: HubMember[];
  teams: HubTeam[];
  pending: boolean;
  save(body: unknown, batch?: boolean): Promise<void>;
}) {
  if (assignableSubjects === 0) {
    return (
      <SettingsSection title="Grant access">
        <Alert
          variant="info"
          title="No setup needed for one owner"
          description="Invite a Member or create a Team only when someone else needs access."
        />
      </SettingsSection>
    );
  }
  return (
    <AccessAssignmentForm
      initialSubject={initialSubject}
      initialResource={initialResource}
      editing={editing}
      cancelEdit={cancelEdit}
      catalog={catalog}
      assignments={assignments}
      members={members}
      teams={teams}
      pending={pending}
      save={save}
    />
  );
}

function initialAssignmentDraft(
  editing: AccessAssignment | null,
  initialSubject: string | null,
  initialResource: string | null,
) {
  const constraints = accessConstraintDraft(editing?.constraints ?? {});
  return {
    constraints,
    subject: editing ? subjectKey(editing.subjectKind, editing.subjectId) : initialSubject,
    resource: editing ? `${editing.resourceKind}\0${editing.resourceId}` : initialResource,
    accessLevel: editing ? "current" : null,
    fastMode: editing?.privileges.includes("agent.fast.use") ?? false,
    agentConfigurations:
      constraints.agentConfigurations.length > 0
        ? constraints.agentConfigurations.map(agentConfigurationDraftFrom)
        : [createAgentConfigurationDraft()],
  };
}

function AccessAssignmentForm({
  initialSubject,
  initialResource,
  editing,
  cancelEdit,
  catalog,
  assignments,
  members,
  teams,
  pending,
  save,
}: {
  initialSubject: string | null;
  initialResource: string | null;
  editing: AccessAssignment | null;
  cancelEdit(): void;
  catalog: AccessCatalog;
  assignments: AccessAssignment[];
  members: HubMember[];
  teams: HubTeam[];
  pending: boolean;
  save(body: unknown, batch?: boolean): Promise<void>;
}) {
  const isCurrent = useMountedAccessScope();
  const [initial] = useState(() =>
    initialAssignmentDraft(editing, initialSubject, initialResource),
  );
  const identityDisabled = pending || editing !== null;
  const [subjectKeyValue, setSubjectKeyValue] = useState(initial.subject);
  const [resourceKeyValue, setResourceKeyValue] = useState(initial.resource);
  const [alsoResourceKeys, setAlsoResourceKeys] = useState<readonly string[]>([]);
  const [accessLevel, setAccessLevel] = useState(initial.accessLevel);
  const [conversation, setConversation] = useState<string>(initial.constraints.conversation);
  const [conversationIds, setConversationIds] = useState(initial.constraints.conversationIds);
  const [agentConfigurations, setAgentConfigurations] = useState<AgentConfigurationDraft[]>(
    initial.agentConfigurations,
  );
  const [fastMode, setFastMode] = useState(initial.fastMode);
  const subjectOptions = useMemo(() => assignmentSubjectOptions(members, teams), [members, teams]);
  const resourceOptions = useMemo(
    () => assignmentResourceOptions(catalog.resources, true),
    [catalog.resources],
  );
  const selection = resolveAssignmentSelection({
    editing,
    catalog,
    subjectKeyValue,
    resourceKeyValue,
    alsoResourceKeys,
    accessLevel,
    conversation,
    conversationIds,
    agentConfigurations,
  });
  const siblingOptions = useSiblingProjectOptions(catalog, selection.resource, editing);
  const agentConfigurationCatalog = selection.resource?.agentConfigurationCatalog;
  const changeResource = useCallback((value: string) => {
    setResourceKeyValue(value);
    setAlsoResourceKeys([]);
    setAccessLevel(null);
    setConversation("specific");
    setConversationIds("");
    setFastMode(false);
    setAgentConfigurations([createAgentConfigurationDraft()]);
  }, []);
  // The field offers no "all" option here, so it only ever reports exact ids.
  const changeAlsoResources = useCallback(
    (value: MultiSelection) => setAlsoResourceKeys(value === "*" ? [] : value),
    [],
  );
  const addAgentConfiguration = useCallback(
    () => setAgentConfigurations((current) => [...current, createAgentConfigurationDraft()]),
    [],
  );
  const submit = useCallback(
    () =>
      void submitAccessAssignment({
        isCurrent,
        editing,
        selection,
        assignments,
        members,
        teams,
        agentConfigurations,
        fastMode,
        accessLevel,
        save,
      }),
    [
      accessLevel,
      agentConfigurations,
      assignments,
      editing,
      fastMode,
      isCurrent,
      members,
      save,
      selection,
      teams,
    ],
  );

  return (
    <SettingsSection title={editing ? "Edit access" : "Grant access"}>
      <View style={[settingsStyles.card, styles.form]}>
        {!initial.constraints.valid ? (
          <Alert
            variant="error"
            title="These constraints cannot be edited by this app version."
            description="Use a compatible app to preserve this assignment safely."
          />
        ) : null}
        <SelectField
          label="Team, Member or Guest"
          value={subjectKeyValue}
          selectedDisplay={selectedOptionDisplay(subjectOptions, subjectKeyValue)}
          options={subjectOptions}
          onChange={setSubjectKeyValue}
          placeholder="Choose a Team, Member or Guest"
          emptyText="Create a Team or invite a Member first."
          searchable
          searchPlaceholder="Search Teams, Members, Guest, or email"
          maxOptionsPerGroup={50}
          title="Team, Member or Guest"
          disabled={identityDisabled}
        />
        <SelectField
          label="Resource"
          value={resourceKeyValue}
          selectedDisplay={selectedOptionDisplay(resourceOptions, resourceKeyValue)}
          options={resourceOptions}
          onChange={changeResource}
          placeholder="Choose a Channel Route, Host, Project, or Automation"
          emptyText="No resources are available."
          searchable
          searchPlaceholder="Search resources or parent Host"
          maxOptionsPerGroup={50}
          title="Resource"
          disabled={identityDisabled}
        />
        {siblingOptions.length > 0 ? (
          <MultiSelectField
            label="Also apply to"
            hint="Projects on the same Host, each written as its own assignment. To cover every Project, including ones added later, grant the Host instead."
            options={siblingOptions}
            value={alsoResourceKeys}
            onChange={changeAlsoResources}
            disabled={identityDisabled}
            placeholder="Only the Resource above"
            searchPlaceholder="Search Projects"
          />
        ) : null}
        {selection.resource?.kind === "daemon" && selection.needsAgentConfiguration ? (
          <Alert
            variant="info"
            title="Applies to every Project on this Host"
            description="Including Projects added later. A Project assignment can only add to this one, never narrow it."
          />
        ) : null}
        <SelectField
          label="Access level"
          value={accessLevel}
          selectedDisplay={selectedOptionDisplay(selection.levelOptions, accessLevel)}
          options={selection.levelOptions}
          onChange={setAccessLevel}
          placeholder="Choose an access level"
          emptyText="Choose a supported resource first."
          title="Access level"
          disabled={pending || selection.resource === undefined}
        />
        {selection.resource?.kind === "channel_account" ? (
          <ConversationFields
            channelAccount={selection.channelAccount}
            conversation={conversation}
            setConversation={setConversation}
            conversationIds={conversationIds}
            setConversationIds={setConversationIds}
            pending={pending}
          />
        ) : null}
        {selection.needsAgentConfiguration ? (
          <AgentConfigurationSection
            catalog={agentConfigurationCatalog}
            configurations={agentConfigurations}
            setConfigurations={setAgentConfigurations}
            addConfiguration={addAgentConfiguration}
            fastMode={fastMode}
            setFastMode={setFastMode}
            pending={pending}
          />
        ) : null}
        <Button
          disabled={pending || !selection.valid || !initial.constraints.valid}
          onPress={submit}
        >
          {editing ? "Save access" : "Grant access"}
        </Button>
        {editing ? (
          <Button variant="ghost" disabled={pending} onPress={cancelEdit}>
            Cancel
          </Button>
        ) : null}
      </View>
    </SettingsSection>
  );
}

/** Which conversations on a Channel Route a grant covers. */
function ConversationFields({
  channelAccount,
  conversation,
  setConversation,
  conversationIds,
  setConversationIds,
  pending,
}: {
  channelAccount: AssignmentSelection["channelAccount"];
  conversation: string;
  setConversation(value: string): void;
  conversationIds: string;
  setConversationIds(value: string): void;
  pending: boolean;
}) {
  const conversationDisplay = useMemo(
    () => ({ label: conversationLabel(conversation) }),
    [conversation],
  );
  return (
    <>
      <SelectField
        label="Conversations"
        value={conversation}
        selectedDisplay={conversationDisplay}
        options={CONVERSATION_OPTIONS}
        onChange={setConversation}
        placeholder="Choose conversation access"
        emptyText="No conversation scopes are available."
        title="Conversations"
        disabled={pending}
      />
      {conversation === "specific" ? (
        <ConversationSelectionFields
          channel={channelAccount?.channel ?? null}
          accountId={channelAccount?.accountId ?? null}
          value={conversationIds}
          onChange={setConversationIds}
          disabled={pending}
          hint="Threads inherit their root Conversation unless selected explicitly."
          placeholder="C0123, C0456"
        />
      ) : null}
    </>
  );
}

/** The Agent choices a grant may start, plus the Fast mode switch that rides with them. */
function AgentConfigurationSection({
  catalog,
  configurations,
  setConfigurations,
  addConfiguration,
  fastMode,
  setFastMode,
  pending,
}: {
  catalog: AccessResource["agentConfigurationCatalog"];
  configurations: AgentConfigurationDraft[];
  setConfigurations(
    update: (current: AgentConfigurationDraft[]) => AgentConfigurationDraft[],
  ): void;
  addConfiguration(): void;
  fastMode: boolean;
  setFastMode(value: boolean): void;
  pending: boolean;
}) {
  return (
    <>
      {/* A field label like "Access level" above it; the rows explain themselves. */}
      <Field label="Allowed Agent configurations">
        {catalog?.providers.length ? (
          <View style={styles.configurationList}>
            {configurations.map((configuration, index) => (
              <AgentConfigurationGrantEditor
                key={configuration.id}
                index={index}
                catalog={catalog}
                value={configuration}
                disabled={pending}
                canRemove={configurations.length > 1}
                setConfigurations={setConfigurations}
              />
            ))}
            <Button size="xs" variant="outline" disabled={pending} onPress={addConfiguration}>
              Add Agent configuration
            </Button>
          </View>
        ) : (
          <Alert
            variant="warning"
            title="Agent choices are not available yet"
            description="Keep the Host connected, then reopen Access after its Provider catalog is published."
          />
        )}
      </Field>
      <View style={styles.switchRow}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>Use Fast mode</Text>
          <Text style={settingsStyles.rowHint}>
            Off by default because Fast mode may cost more.
          </Text>
        </View>
        <Switch value={fastMode} onValueChange={setFastMode} disabled={pending} />
      </View>
    </>
  );
}

/**
 * Projects that share the selected Project's Host. One grant action covers a
 * subset of a Host; covering all of it is a Host assignment, not many rows.
 */
function useSiblingProjectOptions(
  catalog: AccessCatalog,
  resource: AccessResource | undefined,
  editing: AccessAssignment | null,
): SelectFieldOption<string>[] {
  return useMemo(() => {
    if (editing !== null || resource?.kind !== "project" || resource.parent === null) return [];
    return catalog.resources
      .filter(
        (candidate) =>
          candidate.kind === "project" &&
          candidate.available &&
          candidate.id !== resource.id &&
          candidate.parent?.id === resource.parent?.id,
      )
      .map((candidate) => ({
        id: resourceKey(candidate),
        value: resourceKey(candidate),
        label: candidate.name,
      }));
  }, [catalog.resources, editing, resource]);
}
