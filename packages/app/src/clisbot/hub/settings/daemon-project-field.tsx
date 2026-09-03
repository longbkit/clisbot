import { useMemo } from "react";
import { Text } from "react-native";
import type { SelectFieldOption } from "@/components/ui/select-field";
import { SelectField } from "@/components/ui/select-field";
import { useFetchQuery } from "@/data/query";
import { settingsStyles } from "@/styles/settings";
import { useHubAccount } from "../account-provider";
import { HubDaemonProjectsSchema } from "../contracts";

export function DaemonProjectField({
  daemonId,
  value,
  onChange,
  disabled,
}: {
  daemonId: string | null;
  value: string | null;
  onChange(projectId: string): void;
  disabled: boolean;
}) {
  const hub = useHubAccount();
  const organizationId = hub.signedIn?.organization.id ?? "";
  const projects = useFetchQuery({
    queryKey: ["clisbot", "hub", hub.origin, organizationId, "daemon-projects", daemonId],
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
          description: project.projectId,
        })),
    [projects.data?.projects],
  );
  const selected = options.find((option) => option.value === value);
  const selectedDisplay = useMemo(
    () =>
      selected === undefined
        ? null
        : {
            label: selected.label,
            ...(selected.description === undefined ? {} : { description: selected.description }),
          },
    [selected],
  );

  return (
    <>
      <SelectField
        label="Project"
        value={value}
        selectedDisplay={selectedDisplay}
        options={options}
        onChange={onChange}
        placeholder="Choose a Project"
        emptyText={
          projects.isPending ? "Loading Projects…" : "No active Projects are reported by this Host."
        }
        searchable={options.length > 6}
        title="Project"
        disabled={disabled || daemonId === null}
      />
      {projects.error ? <Text style={settingsStyles.rowHint}>{projects.error.message}</Text> : null}
    </>
  );
}
