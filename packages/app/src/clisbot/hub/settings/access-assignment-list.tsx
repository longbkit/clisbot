import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { ChevronDown, ChevronRight } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { settingsStyles } from "@/styles/settings";
import {
  accessLevelLabel,
  constraintSummary,
  grantedByLabel,
  privilegeLabel,
  resourceKindLabel,
  type AccessAssignment,
  type AccessCatalog,
  type AccessResource,
  type SubjectKind,
} from "./access-catalog";
import { privilegesWithinHoldings, viewerHoldings, type ViewerAuthority } from "./access-grantor";
import { matchingAccessLevel, sharesAccess } from "./access-level-summary";
import { accessSettingsStyles as styles } from "./access-settings-styles";
import { EmptyRow } from "./access-settings-feedback";

const SUBJECT_ASSIGNMENT_LABELS: Record<SubjectKind, string> = {
  team: "Team assignment",
  member: "Direct Member assignment",
  guest: "Guest assignment",
};

export function assignmentSubjectName(
  subject: { kind: SubjectKind; id: string },
  teamById: Map<string, string>,
  memberById: Map<string, string>,
): string {
  if (subject.kind === "guest") return "Guest";
  return subject.kind === "team"
    ? (teamById.get(subject.id) ?? "Team")
    : (memberById.get(subject.id) ?? "Member");
}

/**
 * Assignments that differ only by Resource are one decision the operator made in
 * one action, so they read as one row. Editing and removal stay per assignment.
 */
function groupAssignments(assignments: AccessAssignment[]): AccessAssignment[][] {
  const groups = new Map<string, AccessAssignment[]>();
  for (const assignment of assignments) {
    const key = [
      assignment.subjectKind,
      assignment.subjectId,
      assignment.resourceKind,
      [...assignment.privileges].sort().join(","),
      JSON.stringify(assignment.constraints),
    ].join("\0");
    groups.set(key, [...(groups.get(key) ?? []), assignment]);
  }
  return [...groups.values()];
}

/** What every row needs to name itself and decide whether the viewer may touch it. */
export interface AssignmentRowContext {
  accessLevels: AccessCatalog["accessLevels"];
  resources: AccessResource[];
  resourceByKey: Map<string, AccessResource>;
  /** Member names by user id, for "by <name>" (`createdByUserId` is a user id). */
  memberNameByUserId: Map<string, string>;
  authority: ViewerAuthority;
}

export function ExplicitAssignments({
  assignments,
  context,
  teamById,
  teamMembersById,
  memberById,
  pending,
  remove,
  edit,
}: {
  assignments: AccessAssignment[];
  context: AssignmentRowContext;
  teamById: Map<string, string>;
  teamMembersById: Map<string, string>;
  memberById: Map<string, string>;
  pending: boolean;
  remove(assignmentId: string): Promise<void>;
  edit(assignment: AccessAssignment): void;
}) {
  const groups = useMemo(() => groupAssignments(assignments), [assignments]);
  return (
    <View style={settingsStyles.card}>
      {assignments.length === 0 ? (
        <EmptyRow message="No assignments for this selection. The owner still has full access." />
      ) : (
        groups.map((group, index) => (
          <AssignmentGroupRows
            key={group[0]!.id}
            group={group}
            context={context}
            subjectName={assignmentSubjectName(
              { kind: group[0]!.subjectKind, id: group[0]!.subjectId },
              teamById,
              memberById,
            )}
            subjectDetail={
              group[0]!.subjectKind === "team"
                ? teamMembersById.get(group[0]!.subjectId)
                : undefined
            }
            bordered={index > 0}
            pending={pending}
            remove={remove}
            edit={edit}
          />
        ))
      )}
    </View>
  );
}

function AssignmentGroupRows({
  group,
  context,
  subjectName,
  subjectDetail,
  bordered,
  pending,
  remove,
  edit,
}: {
  group: AccessAssignment[];
  context: AssignmentRowContext;
  subjectName: string | undefined;
  subjectDetail: string | undefined;
  bordered: boolean;
  pending: boolean;
  remove(assignmentId: string): Promise<void>;
  edit(assignment: AccessAssignment): void;
}) {
  const [expanded, setExpanded] = useState(false);
  const toggle = useCallback(() => setExpanded((current) => !current), []);
  const { resourceByKey } = context;
  const resourceOf = useCallback(
    (assignment: AccessAssignment) =>
      resourceByKey.get(`${assignment.resourceKind}\0${assignment.resourceId}`),
    [resourceByKey],
  );
  if (group.length === 1) {
    return (
      <ExplicitAssignmentRow
        assignment={group[0]!}
        context={context}
        subjectName={subjectName}
        subjectDetail={subjectDetail}
        bordered={bordered}
        pending={pending}
        remove={remove}
        edit={edit}
      />
    );
  }
  const first = group[0]!;
  const parents = [
    ...new Set(
      group.flatMap((assignment) => {
        const parent = resourceOf(assignment)?.parent;
        return parent ? [resourceByKey.get(`${parent.kind}\0${parent.id}`)?.name ?? parent.id] : [];
      }),
    ),
  ];
  return (
    <>
      <View style={[settingsStyles.row, styles.row, bordered ? settingsStyles.rowBorder : null]}>
        <Button
          size="xs"
          variant="ghost"
          leftIcon={expanded ? ChevronDown : ChevronRight}
          onPress={toggle}
          accessibilityLabel={expanded ? "Collapse" : "Expand"}
        />
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>
            {`${subjectName ?? "Unavailable subject"} · ${String(group.length)} ${resourceKindLabel(first.resourceKind)}s`}
            {parents.length > 0 ? ` · ${parents.join(", ")}` : ""}
          </Text>
          <Text style={settingsStyles.rowHint}>{assignmentDetail(first, context)}</Text>
          {subjectDetail ? (
            <Text style={settingsStyles.rowHint}>Members: {subjectDetail}</Text>
          ) : null}
        </View>
      </View>
      {expanded
        ? group.map((assignment) => (
            <ExplicitAssignmentRow
              key={assignment.id}
              assignment={assignment}
              context={context}
              subjectName={subjectName}
              subjectDetail={undefined}
              bordered
              pending={pending}
              remove={remove}
              edit={edit}
            />
          ))
        : null}
    </>
  );
}

function assignmentDetail(assignment: AccessAssignment, context: AssignmentRowContext): string {
  const summary = constraintSummary(assignment.constraints);
  return [
    SUBJECT_ASSIGNMENT_LABELS[assignment.subjectKind],
    resourceKindLabel(assignment.resourceKind),
    grantedAccessLabel(assignment, context.accessLevels),
    ...(sharesAccess(assignment.resourceKind, assignment.privileges) ? ["Can share"] : []),
    ...(summary ? [summary] : []),
    grantedByLabel(assignment, context.memberNameByUserId),
  ].join(" · ");
}

/** A row above the viewer's own level shows locked: no Edit, no Remove. */
function withinViewer(assignment: AccessAssignment, context: AssignmentRowContext): boolean {
  const resource = context.resourceByKey.get(
    `${assignment.resourceKind}\0${assignment.resourceId}`,
  ) ?? { kind: assignment.resourceKind, id: assignment.resourceId, parent: null };
  return privilegesWithinHoldings(
    viewerHoldings(context.authority, resource, context.resources),
    assignment.privileges,
  );
}

/** The level name when the grant still equals one; the privilege list only for custom grants. */
function grantedAccessLabel(
  assignment: AccessAssignment,
  accessLevels: AccessCatalog["accessLevels"],
): string {
  const level = matchingAccessLevel(accessLevels, assignment.resourceKind, assignment.privileges);
  if (level === undefined) {
    return `Custom: ${assignment.privileges.map(privilegeLabel).join(", ")}`;
  }
  const fastMode = assignment.privileges.includes("agent.fast.use") ? " + Fast mode" : "";
  return `${accessLevelLabel(level)}${fastMode}`;
}

function ExplicitAssignmentRow({
  assignment,
  context,
  subjectName,
  subjectDetail,
  bordered,
  pending,
  remove,
  edit,
}: {
  assignment: AccessAssignment;
  context: AssignmentRowContext;
  subjectName: string | undefined;
  subjectDetail: string | undefined;
  bordered: boolean;
  pending: boolean;
  remove(assignmentId: string): Promise<void>;
  edit(assignment: AccessAssignment): void;
}) {
  const handleRemove = useCallback(() => void remove(assignment.id), [assignment.id, remove]);
  const handleEdit = useCallback(() => edit(assignment), [assignment, edit]);
  const resource = context.resourceByKey.get(
    `${assignment.resourceKind}\0${assignment.resourceId}`,
  );
  const locked = !withinViewer(assignment, context);
  return (
    <View style={[settingsStyles.row, styles.row, bordered ? settingsStyles.rowBorder : null]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>
          {`${subjectName ?? "Unavailable subject"} · ${resource?.name ?? assignment.resourceId}`}
        </Text>
        <Text style={settingsStyles.rowHint}>{assignmentDetail(assignment, context)}</Text>
        {subjectDetail ? (
          <Text style={settingsStyles.rowHint}>Members: {subjectDetail}</Text>
        ) : null}
      </View>
      {locked ? (
        <Text style={settingsStyles.rowHint}>Locked · above your level</Text>
      ) : (
        <>
          <Button
            size="xs"
            variant="outline"
            disabled={pending || !resource?.available}
            onPress={handleEdit}
          >
            Edit
          </Button>
          <Button size="xs" variant="ghost" disabled={pending} onPress={handleRemove}>
            Remove
          </Button>
        </>
      )}
    </View>
  );
}
