import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
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

interface DaemonProjectFieldProps {
  daemonId: string | null;
  serverId: string | null;
  value: string | null;
  cwd: string;
  onChange(projectId: string): void;
  onCwdChange(cwd: string): void;
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
  const customDirectory = directory.mode !== "project";
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
    <>
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
        searchable={options.length > 6}
        title="Project"
        disabled={disabled || daemonId === null}
      />
      {projects.error ? <Text style={settingsStyles.rowHint}>{projects.error.message}</Text> : null}
      {directory.projectId !== null ? (
        <>
          {directory.rootPath !== null ? (
            <Text style={settingsStyles.rowHint}>{directory.rootPath}</Text>
          ) : (
            <View>
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
                onPress={localProjects.refetch}
              >
                Refresh Projects
              </Button>
            </View>
          )}
          <View style={settingsStyles.row}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>Use a custom working directory</Text>
            </View>
            <Switch
              accessibilityLabel="Use a custom working directory"
              value={customDirectory}
              onValueChange={model.setCustomDirectory}
              disabled={disabled}
            />
          </View>
          {customDirectory ? (
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
          ) : null}
        </>
      ) : null}
    </>
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
