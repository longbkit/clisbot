import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { SelectFieldOption } from "@/components/ui/select-field";
import { SelectField } from "@/components/ui/select-field";
import { useFetchQuery } from "@/data/query";
import { settingsStyles } from "@/styles/settings";
import { useHubAccount } from "../account-provider";
import { hubResourceQueryKey } from "../query-keys";
import { HubDaemonProjectsSchema } from "../contracts";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { Switch } from "@/components/ui/switch";
import { useProjects } from "@/hooks/use-projects";
import { isHostRuntimeDirectoryLoading, useHostRuntimeSnapshot } from "@/runtime/host-runtime";
import {
  getProjectHostEntry,
  getProjectSummaryForHostProject,
  type ProjectSummary,
} from "@/utils/projects";
import { openProjectDirectoryForm } from "./project-directory-form";
import {
  WORK_LOCATION_OPTIONS,
  WorktreeTargetFields,
  type WorkLocation,
} from "./managed-workspace-fields";
import type { WorkspaceConfigurationValue } from "../workspace-configuration";

type ProjectDirectoryForm = ReturnType<typeof openProjectDirectoryForm>;
type ProjectDirectoryState = ReturnType<ProjectDirectoryForm["getState"]>;

interface DaemonProjectFieldProps {
  daemonId: string | null;
  serverId: string | null;
  value: string | null;
  cwd: string;
  onChange(projectId: string): void;
  onCwdChange(cwd: string): void;
  /** Offers isolated worktrees beside a folder inside the Project, as one choice. */
  workspace?: {
    value: WorkspaceConfigurationValue;
    onChange(value: WorkspaceConfigurationValue): void;
  };
  disabled: boolean;
}

export function DaemonProjectField(props: DaemonProjectFieldProps) {
  const hub = useHubAccount();
  const key = JSON.stringify([
    hub.origin,
    hub.signedIn?.organization.id,
    hub.signedIn?.account.id,
    props.daemonId,
    props.serverId,
  ]);
  return <ProjectDirectoryField key={key} {...props} />;
}

function ProjectDirectoryField({
  daemonId,
  serverId,
  value,
  cwd,
  onChange,
  onCwdChange,
  workspace,
  disabled,
}: DaemonProjectFieldProps) {
  const hub = useHubAccount();
  const organizationId = hub.signedIn?.organization.id ?? "";
  const accountId = hub.signedIn?.account.id ?? null;
  const [model] = useState(() => openProjectDirectoryForm({ projectId: value, cwd }));
  const directory = useSyncExternalStore(model.subscribe, model.getState, model.getState);
  const localProjects = useProjects({ enabled: serverId !== null });
  const host = useHostRuntimeSnapshot(serverId ?? "");
  const rootPath = projectRootPath(localProjects.projects, serverId, directory.projectId);
  useEffect(() => {
    model.applyRoot(directory.projectId, rootPath);
  }, [model, directory.projectId, rootPath]);
  useEffect(() => {
    onCwdChange(directory.cwd);
  }, [directory.cwd, onCwdChange]);
  const loadingRoot = host !== null && isHostRuntimeDirectoryLoading(host);
  const changeProject = useCallback(
    (projectId: string) => {
      if (projectId === directory.projectId) return;
      model.selectProject(projectId);
      onCwdChange("");
      onChange(projectId);
    },
    [directory.projectId, model, onChange, onCwdChange],
  );
  const projects = useFetchQuery({
    queryKey: [
      ...hubResourceQueryKey({ origin: hub.origin, organizationId, accountId }, "daemon-projects"),
      daemonId,
    ],
    queryFn: () => hub.api().get(`daemons/${daemonId}/projects`, HubDaemonProjectsSchema),
    enabled: daemonId !== null && organizationId.length > 0,
    retry: false,
    dataShape: "value",
    staleTimeMs: 15_000,
  });
  const options = useMemo<SelectFieldOption<string>[]>(
    () =>
      (projects.data?.projects ?? [])
        .filter((project) => project.available)
        .map((project) => ({
          id: project.id,
          value: project.projectId,
          label: project.name,
        })),
    [projects.data?.projects],
  );
  const selected = options.find((option) => option.value === directory.projectId);
  const selectedDisplay = useMemo(
    () => (selected === undefined ? null : { label: selected.label }),
    [selected],
  );

  return (
    // The Project folder and the directory controls read as one group, so they
    // sit tighter together than the form's spacing between unrelated fields.
    <View style={styles.group}>
      <SelectField
        label="Project"
        value={directory.projectId}
        selectedDisplay={selectedDisplay}
        options={options}
        onChange={changeProject}
        placeholder="Choose a Project"
        emptyText={
          projects.isPending ? "Loading Projects…" : "No active Projects are reported by this Host."
        }
        hint={directory.rootPath ?? undefined}
        error={projects.error?.message ?? null}
        searchable={options.length > 6}
        title="Project"
        disabled={disabled || daemonId === null}
      />
      {directory.projectId === null ? null : (
        <ProjectDirectoryControls
          directory={directory}
          model={model}
          host={host}
          loadingRoot={loadingRoot}
          refreshProjects={localProjects.refetch}
          workspace={workspace}
          disabled={disabled}
        />
      )}
    </View>
  );
}

/** The Project folder readout and where the Agent works, once a Project is chosen. */
function ProjectDirectoryControls({
  directory,
  model,
  host,
  loadingRoot,
  refreshProjects,
  workspace,
  disabled,
}: {
  directory: ProjectDirectoryState;
  model: ProjectDirectoryForm;
  host: ReturnType<typeof useHostRuntimeSnapshot>;
  loadingRoot: boolean;
  refreshProjects(): void;
  workspace: DaemonProjectFieldProps["workspace"];
  disabled: boolean;
}) {
  return (
    <>
      {directory.rootPath === null ? (
        <View style={styles.missingRoot}>
          <Text style={settingsStyles.rowHint}>
            {projectFolderHint(loadingRoot, host?.connectionStatus === "online")}
          </Text>
          {host?.agentDirectoryError ? (
            <Text style={settingsStyles.rowError}>{host.agentDirectoryError}</Text>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            disabled={disabled || loadingRoot}
            onPress={refreshProjects}
          >
            Refresh Projects
          </Button>
        </View>
      ) : null}
      {workspace === undefined ? (
        <CustomDirectoryFields directory={directory} model={model} disabled={disabled} />
      ) : (
        <WorkLocationFields
          directory={directory}
          model={model}
          workspace={workspace}
          disabled={disabled}
        />
      )}
    </>
  );
}

/** The working directory override alone, where worktrees are not offered. */
function CustomDirectoryFields({
  directory,
  model,
  disabled,
}: {
  directory: ProjectDirectoryState;
  model: ProjectDirectoryForm;
  disabled: boolean;
}) {
  const customDirectory = directory.mode !== "project";
  return (
    <>
      <SwitchRowControl
        label="Use a custom working directory"
        value={customDirectory}
        onChange={model.setCustomDirectory}
        disabled={disabled}
      />
      {customDirectory ? (
        <WorkingDirectoryField directory={directory} model={model} disabled={disabled} />
      ) : null}
    </>
  );
}

/**
 * Where the Agent works. Off (the default), it works in the Project folder.
 * On, one choice: a folder inside the Project, or an isolated worktree of its
 * repository. They exclude each other: a worktree starts at its own root.
 */
function WorkLocationFields({
  directory,
  model,
  workspace,
  disabled,
}: {
  directory: ProjectDirectoryState;
  model: ProjectDirectoryForm;
  workspace: NonNullable<DaemonProjectFieldProps["workspace"]>;
  disabled: boolean;
}) {
  const { value, onChange } = workspace;
  const location = workLocation(value, directory);
  const choose = useCallback(
    (next: WorkLocation | null) => {
      model.setCustomDirectory(next === "folder");
      onChange({ ...value, behavior: next === null || next === "folder" ? "project" : next });
    },
    [model, onChange, value],
  );
  const toggle = useCallback((on: boolean) => choose(on ? "folder" : null), [choose]);
  const selected = WORK_LOCATION_OPTIONS.find((option) => option.value === location);
  const selectedDisplay = useMemo(
    () => (selected ? { label: selected.label, description: selected.description } : null),
    [selected],
  );
  return (
    <>
      <SwitchRowControl
        label="Work outside the Project folder"
        value={location !== null}
        onChange={toggle}
        disabled={disabled}
      />
      {location === null ? null : (
        <>
          <SelectField
            label="Where the Agent works"
            value={location}
            selectedDisplay={selectedDisplay}
            options={WORK_LOCATION_OPTIONS}
            onChange={choose}
            placeholder="Choose where the Agent works"
            emptyText="No choices are available."
            title="Where the Agent works"
            disabled={disabled}
          />
          {location === "folder" ? (
            <WorkingDirectoryField directory={directory} model={model} disabled={disabled} />
          ) : (
            <WorktreeTargetFields value={value} onChange={onChange} disabled={disabled} />
          )}
        </>
      )}
    </>
  );
}

/** The chosen place: a worktree kind, a folder inside the Project, or none. */
function workLocation(
  value: WorkspaceConfigurationValue,
  directory: ProjectDirectoryState,
): WorkLocation | null {
  if (value.behavior !== "project") return value.behavior;
  return directory.mode === "project" ? null : "folder";
}

function WorkingDirectoryField({
  directory,
  model,
  disabled,
}: {
  directory: ProjectDirectoryState;
  model: ProjectDirectoryForm;
  disabled: boolean;
}) {
  return (
    <Field
      label="Working directory"
      hint="Absolute path on this Host, within the selected Project."
    >
      <FormTextInput
        key={directory.projectId}
        initialValue={directory.cwd}
        onChangeText={model.setCwd}
        placeholder={directory.rootPath ?? "Absolute path within the Project"}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!disabled}
      />
    </Field>
  );
}

function SwitchRowControl({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: boolean;
  onChange(value: boolean): void;
  disabled: boolean;
}) {
  return (
    <View style={settingsStyles.formRow}>
      <Text style={[settingsStyles.rowTitle, settingsStyles.formRowContent]}>{label}</Text>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onChange}
        disabled={disabled}
      />
    </View>
  );
}

function projectRootPath(
  projects: readonly ProjectSummary[],
  serverId: string | null,
  projectId: string | null,
): string | null {
  if (serverId === null || projectId === null) return null;
  const project = getProjectSummaryForHostProject(projects, serverId, projectId);
  return getProjectHostEntry(project, serverId, projectId)?.repoRoot ?? null;
}

function projectFolderHint(loading: boolean, online: boolean): string {
  if (loading) return "Loading Project folder…";
  if (online)
    return "Project folder is unavailable. Refresh Projects or check access on this Host.";
  return "Connect this Host to load the Project folder.";
}

const styles = StyleSheet.create((theme) => ({
  group: {
    gap: theme.spacing[2],
  },
  missingRoot: {
    alignItems: "flex-start",
    gap: theme.spacing[2],
  },
}));
