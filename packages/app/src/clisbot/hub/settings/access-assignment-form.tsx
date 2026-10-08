import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/form-field";
import { SelectField, type SelectFieldOption } from "@/components/ui/select-field";
import { Switch } from "@/components/ui/switch";
import { settingsStyles } from "@/styles/settings";
import { useAccessAssignmentDraft } from "./access-assignment-draft";
import { useMountedAccessScope } from "./access-mounted-scope";
import {
  resolveAssignmentSelection,
  type AssignmentSelection,
} from "./access-assignment-selection";
import { grantedPrivileges, submitAccessAssignment } from "./access-assignment-submit";
import { CanShareField } from "./access-can-share-field";
import { SchedulesField } from "./access-schedules-field";
import {
  canShareResource,
  shareableAgentConfigurationCatalog,
  type ViewerAuthority,
} from "./access-grantor";
import { AccessLevelSummary, useQrLoginConnection } from "./access-level-summary-view";
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
import { ProjectFolderFields, TerminalAccessFields } from "./access-terminal-fields";
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
  const { t } = useTranslation();
  // A sheet over the Access list, as Invite people is over People: the form is
  // there only while someone is granting or editing.
  const header = useMemo(
    () => ({
      title: props.editing ? t("hub.access.form.editAccess") : t("hub.access.form.grantAccess"),
    }),
    [props.editing, t],
  );
  return (
    <AdaptiveModalSheet visible header={header} onClose={props.cancelEdit} desktopMaxWidth={560}>
      {assignableSubjects === 0 ? (
        <Alert
          variant="info"
          title={t("hub.access.form.noSetupTitle")}
          description={t("hub.access.form.noSetupDescription")}
        />
      ) : (
        <AccessAssignmentForm {...props} />
      )}
    </AdaptiveModalSheet>
  );
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
  const { t } = useTranslation();
  const isCurrent = useMountedAccessScope();
  const draft = useAccessAssignmentDraft(
    editing,
    initialSubject,
    initialResource,
    isCurrent,
    catalog.accessLevels,
  );
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
    terminal: draft.terminal,
    schedules: draft.schedules,
    terminalProfiles: draft.terminalProfiles,
    projectFolders: draft.projectFolders,
    agentConfigurations: draft.agentConfigurations,
  });
  const siblingOptions = useSiblingProjectOptions(catalog, selection.resource, editing);
  const qrLogin = useQrLoginConnection(selection.resource);
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
        qrLogin,
        authority,
        catalogResources: catalog.resources,
        save,
      }),
    [
      assignments,
      authority,
      catalog,
      draft,
      editing,
      isCurrent,
      members,
      qrLogin,
      save,
      selection,
      teams,
    ],
  );
  return (
    <View style={styles.sheetForm}>
      <FormNotices editing={editing} teams={teams} constraintsValid={draft.constraintsValid} />
      <SelectField
        label={t("hub.access.form.subjectLabel")}
        value={draft.subjectKeyValue}
        selectedDisplay={selectedOptionDisplay(subjectOptions, draft.subjectKeyValue)}
        options={subjectOptions}
        onChange={draft.setSubjectKeyValue}
        placeholder={t("hub.access.form.subjectPlaceholder")}
        emptyText={t("hub.access.form.subjectEmpty")}
        searchable
        searchPlaceholder={t("hub.access.form.subjectSearch")}
        maxOptionsPerGroup={50}
        title={t("hub.access.form.subjectLabel")}
        disabled={identityDisabled}
      />
      <SelectField
        label={t("hub.access.form.resourceLabel")}
        value={draft.resourceKeyValue}
        selectedDisplay={selectedOptionDisplay(resourceOptions, draft.resourceKeyValue)}
        options={resourceOptions}
        onChange={draft.changeResource}
        placeholder={t("hub.access.form.resourcePlaceholder")}
        emptyText={t("hub.access.form.resourceEmpty")}
        searchable
        searchPlaceholder={t("hub.access.form.resourceSearch")}
        maxOptionsPerGroup={50}
        title={t("hub.access.form.resourceLabel")}
        disabled={identityDisabled}
      />
      {siblingOptions.length > 0 ? (
        <MultiSelectField
          label={t("hub.access.form.alsoApplyLabel")}
          hint={t("hub.access.form.alsoApplyHint")}
          options={siblingOptions}
          value={draft.alsoResourceKeys}
          onChange={draft.changeAlsoResources}
          disabled={identityDisabled}
          placeholder={t("hub.access.form.alsoApplyPlaceholder")}
          searchPlaceholder={t("hub.access.form.searchProjects")}
        />
      ) : null}
      <AccessLevelFields
        selection={selection}
        draft={draft}
        editing={editing}
        pending={pending}
        qrLogin={qrLogin}
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
      {selection.resource && selection.needsTerminalProfiles ? (
        <TerminalAccessFields
          resource={selection.resource}
          holdings={selection.holdings}
          terminalSwitch={selection.terminalSwitch}
          terminal={draft.terminal}
          setTerminal={draft.setTerminal}
          profiles={selection.terminalProfiles}
          setProfiles={draft.setTerminalProfiles}
          pending={pending}
        />
      ) : null}
      {selection.createsProjects ? (
        <ProjectFolderFields
          value={selection.projectFolders}
          onChange={draft.setProjectFolders}
          holdings={selection.holdings}
          pending={pending}
        />
      ) : null}
      {grantorError !== null ? (
        <Alert
          variant="error"
          title={t("hub.access.form.grantorErrorTitle")}
          description={grantorError}
        />
      ) : null}
      <Button disabled={pending || !selection.valid || !draft.constraintsValid} onPress={submit}>
        {editing ? t("hub.access.form.saveAccess") : t("hub.access.form.grantAccess")}
      </Button>
      <Button variant="ghost" disabled={pending} onPress={cancelEdit}>
        {t("hub.access.form.cancel")}
      </Button>
    </View>
  );
}

/** What to read before editing: a Team grant changes it for the whole Team. */
function FormNotices({
  editing,
  teams,
  constraintsValid,
}: {
  editing: AccessAssignment | null;
  teams: HubTeam[];
  constraintsValid: boolean;
}) {
  const { t } = useTranslation();
  const sharedTeam =
    editing?.subjectKind === "team" ? teams.find(({ id }) => id === editing.subjectId) : undefined;
  return (
    <>
      {sharedTeam === undefined ? null : (
        <Alert
          variant="warning"
          title={t("hub.access.form.teamGrantTitle", { name: sharedTeam.name })}
          description={t("hub.access.form.teamGrantDescription", {
            count: sharedTeam.userIds.length,
          })}
        />
      )}
      {constraintsValid ? null : (
        <Alert
          variant="error"
          title={t("hub.access.form.constraintsTitle")}
          description={t("hub.access.form.constraintsDescription")}
        />
      )}
    </>
  );
}

/** The level picker, the levels held back, Can share, and what the choice does. */
function AccessLevelFields({
  selection,
  draft,
  editing,
  pending,
  qrLogin,
}: {
  selection: AssignmentSelection;
  draft: ReturnType<typeof useAccessAssignmentDraft>;
  editing: AccessAssignment | null;
  pending: boolean;
  qrLogin: boolean;
}) {
  const { t } = useTranslation();
  return (
    <>
      <SelectField
        label={t("hub.access.form.accessLevelLabel")}
        value={draft.accessLevel}
        selectedDisplay={selectedOptionDisplay(selection.levelOptions, draft.accessLevel)}
        options={selection.levelOptions}
        onChange={draft.changeLevel}
        placeholder={t("hub.access.form.accessLevelPlaceholder")}
        emptyText={t("hub.access.form.accessLevelEmpty")}
        title={t("hub.access.form.accessLevelLabel")}
        disabled={pending || selection.resource === undefined}
      />
      {selection.levelsAboveOwn.length > 0 ? (
        <Text style={settingsStyles.rowHint}>
          {t("hub.access.form.aboveOwn", { levels: selection.levelsAboveOwn.join(", ") })}
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
      {selection.scheduleSwitch ? (
        <SchedulesField value={draft.schedules} onChange={draft.setSchedules} disabled={pending} />
      ) : null}
      {selection.resource ? (
        <AccessLevelSummary
          privileges={grantedPrivileges(selection, draft.fastMode)}
          savedPrivileges={editing?.privileges}
          resourceKind={selection.resource.kind}
          subjectKind={selection.subject?.kind}
          qrLogin={qrLogin}
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
  const { t } = useTranslation();
  return (
    <>
      {/* A field label like "Access level" above it; the rows explain themselves. */}
      <Field label={t("hub.access.form.agentConfigurationsLabel")}>
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
              {t("hub.access.form.addAgentConfiguration")}
            </Button>
          </View>
        ) : (
          <Alert
            variant="warning"
            title={t("hub.access.form.agentChoicesUnavailableTitle")}
            description={t("hub.access.form.agentChoicesUnavailableDescription")}
          />
        )}
      </Field>
      <View style={styles.switchRow}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{t("hub.access.form.useFastMode")}</Text>
          <Text style={settingsStyles.rowHint}>{t("hub.access.form.fastModeHint")}</Text>
        </View>
        <Switch
          value={fastMode}
          onValueChange={setFastMode}
          disabled={pending}
          accessibilityLabel={t("hub.access.form.useFastMode")}
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
