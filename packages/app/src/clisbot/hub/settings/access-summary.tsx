import { Text, View } from "react-native";
import { settingsStyles } from "@/styles/settings";
import { capitalizeLabel, plural } from "./labels";
import { EmptyRow } from "./resource-rows";
import type { HubAccessLevels, HubAccessResource, HubAssignment } from "./team/types";

/** Stable fallback while the access catalog loads. */
export const EMPTY_ACCESS_LEVELS: HubAccessLevels = {};

export interface AccessSummaryEntry {
  assignment: HubAssignment;
  /** Where the access comes from: `Direct`, `Via Support`. */
  source: string;
}

/** Read-only list of resource access assignments with their level and source. */
export function AccessSummary({
  entries,
  resources,
  accessLevels,
  emptyMessage,
}: {
  entries: AccessSummaryEntry[];
  resources: HubAccessResource[];
  accessLevels: HubAccessLevels;
  emptyMessage: string;
}) {
  const resourceByKey = new Map(
    resources.map((resource) => [`${resource.kind}\0${resource.id}`, resource]),
  );
  return (
    <View style={settingsStyles.card}>
      {entries.length === 0 ? (
        <EmptyRow message={emptyMessage} />
      ) : (
        entries.map(({ assignment, source }, index) => {
          const resource = resourceByKey.get(
            `${assignment.resourceKind}\0${assignment.resourceId}`,
          );
          const level = assignmentAccessLevel(accessLevels, assignment);
          const constraints = accessConstraintSummary(assignment.constraints);
          return (
            <View
              key={`${assignment.id}:${source}`}
              style={[settingsStyles.row, index > 0 ? settingsStyles.rowBorder : null]}
            >
              <View style={settingsStyles.rowContent}>
                <Text style={settingsStyles.rowTitle}>
                  {resource?.name ?? "Unavailable resource"}
                </Text>
                <Text style={settingsStyles.rowHint}>
                  {`${hubResourceKindLabel(assignment.resourceKind)} · ${level} · ${source}`}
                </Text>
                <Text style={settingsStyles.rowHint}>
                  {assignment.privileges
                    .map((privilege) => privilege.replaceAll(".", " "))
                    .join(", ") || "No privileges"}
                </Text>
                {constraints === null ? null : (
                  <Text style={settingsStyles.rowHint}>{constraints}</Text>
                )}
              </View>
            </View>
          );
        })
      )}
    </View>
  );
}

/** Assignments held by one subject, e.g. every grant to a Team. */
export function subjectAssignments(
  assignments: readonly HubAssignment[],
  subjectKind: HubAssignment["subjectKind"],
  subjectId: string,
): HubAssignment[] {
  return assignments.filter(
    (assignment) => assignment.subjectKind === subjectKind && assignment.subjectId === subjectId,
  );
}

function assignmentAccessLevel(levels: HubAccessLevels, assignment: HubAssignment): string {
  const fastMode = assignment.privileges.includes("agent.fast.use");
  const target = [
    ...new Set(assignment.privileges.filter((privilege) => privilege !== "agent.fast.use")),
  ].sort();
  const level = Object.entries(levels[assignment.resourceKind] ?? {}).find(([, privileges]) => {
    const candidate = [...new Set(privileges)].sort();
    return (
      candidate.length === target.length &&
      candidate.every((value, index) => value === target[index])
    );
  })?.[0];
  const label =
    level === undefined
      ? `${String(target.length)} ${plural(target.length, "privilege")}`
      : capitalizeLabel(level.replaceAll("_", " "));
  return fastMode ? `${label} · Fast mode` : label;
}

function hubResourceKindLabel(kind: HubAssignment["resourceKind"]): string {
  return {
    organization: "Organization",
    daemon: "Host",
    project: "Project",
    channel_account: "Channel Route",
    automation: "Automation",
  }[kind];
}

function accessConstraintSummary(constraints: Record<string, unknown>): string | null {
  const details: string[] = [];
  const configurations = constraints["agentConfigurations"];
  if (Array.isArray(configurations)) {
    details.push(
      `${String(configurations.length)} Agent ${plural(configurations.length, "configuration")}`,
    );
  }
  const conversation = constraints["conversation"];
  if (typeof conversation === "object" && conversation !== null) {
    const kind = Reflect.get(conversation, "kind");
    if (typeof kind === "string") details.push(capitalizeLabel(kind.replaceAll("_", " ")));
  }
  return details.length === 0 ? null : details.join(" · ");
}
