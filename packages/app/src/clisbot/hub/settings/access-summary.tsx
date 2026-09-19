import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { settingsStyles } from "@/styles/settings";
import {
  accessLevelLabel,
  constraintSummary,
  grantedByLabel,
  privilegeLabel,
  type AccessResourceKind,
} from "./access-catalog";
import { accessLevelDescription, matchingAccessLevel, sharesAccess } from "./access-level-summary";
import { plural } from "./labels";
import { EmptyRow } from "./resource-rows";
import type { HubAccessLevels, HubAccessResource, HubAssignment } from "./team/types";

/** Stable fallback while the access catalog loads. */
export const EMPTY_ACCESS_LEVELS: HubAccessLevels = {};

export interface AccessSummaryEntry {
  assignment: HubAssignment;
  /** Where the access comes from: `Direct`, `Via Support`. */
  source: string;
}

const KIND_ORDER: AccessResourceKind[] = [
  "daemon",
  "project",
  "channel_account",
  "automation",
  "team",
  "organization",
];
const GROUP_LABELS: Record<AccessResourceKind, string> = {
  daemon: "Hosts",
  project: "Projects",
  channel_account: "Connections",
  automation: "Automations",
  team: "Teams",
  organization: "Organization",
};

export interface AccessGroup {
  kind: AccessResourceKind;
  label: string;
  entries: AccessSummaryEntry[];
}

/** Entries by resource kind, Hosts first; a kind with no entry is absent. */
export function groupAccessEntries(entries: readonly AccessSummaryEntry[]): AccessGroup[] {
  return KIND_ORDER.flatMap((kind) => {
    const inKind = entries.filter(({ assignment }) => assignment.resourceKind === kind);
    return inKind.length === 0 ? [] : [{ kind, label: GROUP_LABELS[kind], entries: inKind }];
  });
}

/**
 * Read-only access assignments grouped by resource kind, each with its level,
 * Can share, source, and who granted it.
 */
export function AccessSummary({
  entries,
  resources,
  accessLevels,
  memberNameByUserId,
  emptyMessage,
}: {
  entries: readonly AccessSummaryEntry[];
  resources: readonly HubAccessResource[];
  accessLevels: HubAccessLevels;
  /** Names the grantor ("by Ana"); without it the row omits who granted it. */
  memberNameByUserId?: ReadonlyMap<string, string>;
  emptyMessage: string;
}) {
  const groups = groupAccessEntries(entries);
  if (groups.length === 0) {
    return (
      <View style={settingsStyles.card}>
        <EmptyRow message={emptyMessage} />
      </View>
    );
  }
  const resourceByKey = new Map(resources.map((resource) => [resourceKey(resource), resource]));
  return (
    <View style={styles.groups}>
      {groups.map((group) => (
        <View key={group.kind} style={styles.group}>
          <Text style={styles.groupLabel}>{group.label}</Text>
          <View style={settingsStyles.card}>
            {group.entries.map((entry, index) => (
              <AccessRow
                key={`${entry.assignment.id}:${entry.source}`}
                entry={entry}
                resource={resourceByKey.get(resourceKey(entry.assignment))}
                accessLevels={accessLevels}
                memberNameByUserId={memberNameByUserId}
                bordered={index > 0}
              />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

function AccessRow({
  entry: { assignment, source },
  resource,
  accessLevels,
  memberNameByUserId,
  bordered,
}: {
  entry: AccessSummaryEntry;
  resource: HubAccessResource | undefined;
  accessLevels: HubAccessLevels;
  memberNameByUserId: ReadonlyMap<string, string> | undefined;
  bordered: boolean;
}) {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((current) => !current), []);
  const level = accessLevelLine(accessLevels, assignment);
  const constraints = constraintSummary(assignment.constraints);
  return (
    <View style={[settingsStyles.row, bordered ? settingsStyles.rowBorder : null]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{resource?.name ?? "Unavailable resource"}</Text>
        <Text style={settingsStyles.rowHint}>
          {accessRowFacts({ assignment, source }, level.label, memberNameByUserId)}
        </Text>
        {level.description === undefined ? null : (
          <Text style={settingsStyles.rowHint}>{level.description}</Text>
        )}
        {assignment.resourceKind === "daemon" ? (
          <Text style={settingsStyles.rowHint}>
            Every Project on this Host, including Projects added later
          </Text>
        ) : null}
        {open ? (
          <Text style={settingsStyles.rowHint}>
            {[
              assignment.privileges.map(privilegeLabel).join(", ") || "No privileges",
              ...(constraints === null ? [] : [constraints]),
            ].join(" · ")}
          </Text>
        ) : null}
      </View>
      <Button
        size="xs"
        variant="ghost"
        onPress={toggle}
        accessibilityLabel={`Details of ${resource?.name ?? "access"}`}
      >
        {open ? "Hide details" : "Details"}
      </Button>
    </View>
  );
}

/** Level, Can share, source, and grantor, the same facts the Access page rows show. */
export function accessRowFacts(
  { assignment, source }: AccessSummaryEntry,
  levelLabel: string,
  memberNameByUserId: ReadonlyMap<string, string> | undefined,
): string {
  return [
    levelLabel,
    ...(sharesAccess(assignment.resourceKind, assignment.privileges) ? ["Can share"] : []),
    source,
    ...(memberNameByUserId === undefined ? [] : [grantedByLabel(assignment, memberNameByUserId)]),
  ].join(" · ");
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

function resourceKey(resource: { resourceKind: string; resourceId: string } | HubAccessResource) {
  return "kind" in resource
    ? `${resource.kind}\0${resource.id}`
    : `${resource.resourceKind}\0${resource.resourceId}`;
}

/** The built-in level a grant matches, worded by access-level-summary; a custom grant counts its privileges. */
function accessLevelLine(
  levels: HubAccessLevels,
  assignment: HubAssignment,
): { label: string; description: string | undefined } {
  const levelId = matchingAccessLevel(levels, assignment.resourceKind, assignment.privileges);
  const fastMode = assignment.privileges.includes("agent.fast.use") ? " · Fast mode" : "";
  if (levelId === undefined) {
    const count = assignment.privileges.filter(
      (privilege) => privilege !== "agent.fast.use",
    ).length;
    return {
      label: `${String(count)} ${plural(count, "privilege")}${fastMode}`,
      description: undefined,
    };
  }
  return {
    label: `${accessLevelLabel(levelId)}${fastMode}`,
    description: accessLevelDescription(levelId, assignment.resourceKind),
  };
}

const styles = StyleSheet.create((theme) => ({
  groups: { gap: theme.spacing[3] },
  group: { gap: theme.spacing[1] },
  groupLabel: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
}));
