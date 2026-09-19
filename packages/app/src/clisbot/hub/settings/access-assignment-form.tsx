import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/form-field";
import { SelectField, type SelectFieldOption } from "@/components/ui/select-field";
import { Switch } from "@/components/ui/switch";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { useAccessAssignmentDraft } from "./access-assignment-draft";
import { useMountedAccessScope } from "./access-mounted-scope";
import {
  resolveAssignmentSelection,
  type AssignmentSelection,
} from "./access-assignment-selection";
import { grantedPrivileges, submitAccessAssignment } from "./access-assignment-submit";
import { CanShareField } from "./access-can-share-field";
import {
  canShareResource,
  shareableAgentConfigurationCatalog,
  type ViewerAuthority,
} from "./access-grantor";
import { AccessLevelSummary } from "./access-level-summary-view";
import {
  assignmentResourceOptions,
  assignmentSubjectOptions,
  resourceKey,
  selectedOptionDisplay,
  type AccessAssignment,
  type AccessCatalog,
  type AccessResource,
  type HubMember,
  type HubTeam,
} from "./access-catalog";
import { accessSettingsStyles as styles } from "./access-settings-styles";
import { MultiSelectField } from "./multi-select-field";
import {
  AgentConfigurationGrantEditor,
  type AgentConfigurationDraft,
} from "./agent-configuration-grant-fields";

interface AccessAssignmentFormProps {
  initialSubject: string | null;
  initialResource: string | null;
  editing: AccessAssignment | null;
  cancelEdit(): void;
  catalog: AccessCatalog;
  assignments: AccessAssignment[];
  members: HubMember[];
  teams: HubTeam[];
  /** What the viewer may grant; the form offers nothing beyond it. */
  authority: ViewerAuthority;
  /** The Hub's refusal of the last save, when it exceeded the viewer's own access. */
  grantorError: string | null;
  pending: boolean;
  save(body: unknown, batch?: boolean): Promise<void>;
}

export function GrantAccessContent({
  assignableSubjects,
  ...props
}: AccessAssignmentFormProps & { assignableSubjects: number }) {
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
  return <AccessAssignmentForm {...props} />;
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
  authority,
  grantorError,
  pending,
  save,
}: AccessAssignmentFormProps) {
  const isCurrent = useMountedAccessScope();
  const draft = useAccessAssignmentDraft(editing, initialSubject, initialResource, isCurrent);
  const identityDisabled = pending || editing !== null;
  const subjectOptions = useMemo(() => assignmentSubjectOptions(members, teams), [members, teams]);
  const resourceOptions = useMemo(
    () =>
      assignmentResourceOptions(
        catalog.resources.filter((resource) =>
          canShareResource(authority, resource, catalog.resources),
        ),
        true,
      ),
    [authority, catalog.resources],
  );
  const selection = resolveAssignmentSelection({
    editing,
    catalog,
    authority,
    subjectKeyValue: draft.subjectKeyValue,
    resourceKeyValue: draft.resourceKeyValue,
    alsoResourceKeys: draft.alsoResourceKeys,
    accessLevel: draft.accessLevel,
    canShare: draft.canShare,
    agentConfigurations: draft.agentConfigurations,
  });
  const siblingOptions = useSiblingProjectOptions(catalog, selection.resource, editing);
  const submit = useCallback(
    () =>
      void submitAccessAssignment({
        isCurrent,
        editing,
        selection,
        assignments,
        members,
        teams,
        agentConfigurations: draft.agentConfigurations,
        fastMode: draft.fastMode,
        accessLevel: draft.accessLevel,
        authority,
        catalogResources: catalog.resources,
        save,
      }),
    [assignments, authority, catalog, draft, editing, isCurrent, members, save, selection, teams],
  );

  return (
    <SettingsSection title={editing ? "Edit access" : "Grant access"}>
      <View style={[settingsStyles.card, styles.form]}>
        {!draft.constraintsValid ? (
          <Alert
            variant="error"
            title="These constraints cannot be edited by this app version."
            description="Use a compatible app to preserve this assignment safely."
          />
        ) : null}
        <SelectField
          label="Team, Member or Guest"
          value={draft.subjectKeyValue}
          selectedDisplay={selectedOptionDisplay(subjectOptions, draft.subjectKeyValue)}
          options={subjectOptions}
          onChange={draft.setSubjectKeyValue}
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
          value={draft.resourceKeyValue}
          selectedDisplay={selectedOptionDisplay(resourceOptions, draft.resourceKeyValue)}
          options={resourceOptions}
          onChange={draft.changeResource}
          placeholder="Choose a Host, Project, Team, Connection, or Automation"
          emptyText="No resources you can share are available."
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
            value={draft.alsoResourceKeys}
            onChange={draft.changeAlsoResources}
            disabled={identityDisabled}
            placeholder="Only the Resource above"
            searchPlaceholder="Search Projects"
          />
        ) : null}
        <AccessLevelFields
          selection={selection}
          draft={draft}
          editing={editing}
          pending={pending}
        />
        {selection.needsAgentConfiguration ? (
          <AgentConfigurationSection
            catalog={shareableAgentConfigurationCatalog(
              selection.resource?.agentConfigurationCatalog,
              selection.holdings,
            )}
            configurations={draft.agentConfigurations}
            setConfigurations={draft.setAgentConfigurations}
            addConfiguration={draft.addAgentConfiguration}
            fastMode={draft.fastMode}
            setFastMode={draft.setFastMode}
            pending={pending}
          />
        ) : null}
        {grantorError !== null ? (
          <Alert variant="error" title="Above what you can grant" description={grantorError} />
        ) : null}
        <Button disabled={pending || !selection.valid || !draft.constraintsValid} onPress={submit}>
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

/** The level picker, the levels held back, Can share, and what the choice does. */
function AccessLevelFields({
  selection,
  draft,
  editing,
  pending,
}: {
  selection: AssignmentSelection;
  draft: ReturnType<typeof useAccessAssignmentDraft>;
  editing: AccessAssignment | null;
  pending: boolean;
}) {
  return (
    <>
      <SelectField
        label="Access level"
        value={draft.accessLevel}
        selectedDisplay={selectedOptionDisplay(selection.levelOptions, draft.accessLevel)}
        options={selection.levelOptions}
        onChange={draft.changeLevel}
        placeholder="Choose an access level"
        emptyText="Choose a supported resource first."
        title="Access level"
        disabled={pending || selection.resource === undefined}
      />
      {selection.levelsAboveOwn.length > 0 ? (
        <Text style={settingsStyles.rowHint}>
          Above your own level, not offered: {selection.levelsAboveOwn.join(", ")}
        </Text>
      ) : null}
      {selection.resource ? (
        <CanShareField
          state={selection.canShare}
          resourceKind={selection.resource.kind}
          value={draft.canShare}
          onChange={draft.setCanShare}
          disabled={pending}
        />
      ) : null}
      {selection.resource ? (
        <AccessLevelSummary
          privileges={grantedPrivileges(selection, draft.fastMode)}
          savedPrivileges={editing?.privileges}
          resourceKind={selection.resource.kind}
          subjectKind={selection.subject?.kind}
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
        <Switch
          value={fastMode}
          onValueChange={setFastMode}
          disabled={pending}
          accessibilityLabel="Use Fast mode"
        />
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
