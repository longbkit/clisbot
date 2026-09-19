// The Access list as data: one row per grant (Who × Resource × Level and its
// modifiers), grouped by who holds it or by what it is on.
// Pure functions, no React: docs/features/access/access-screen.md.

import {
  accessLevelLabel,
  constraintSummary,
  grantorName,
  resourceKey,
  resourceKindLabel,
  type AccessAssignment,
  type AccessCatalog,
  type AccessResource,
  type AccessResourceKind,
  type HubMember,
  type HubTeam,
  type SubjectKind,
} from "./access-catalog";
import { privilegesWithinHoldings, viewerHoldings, type ViewerAuthority } from "./access-grantor";
import { matchingAccessLevel } from "./access-level-summary";
import { countLabel } from "./labels";

export type GrantGrouping = "subject" | "resource";

export interface GrantRow {
  key: string;
  subject: { kind: SubjectKind; id: string; name: string };
  resource: { kind: AccessResourceKind; id: string; name: string; context: string };
  /** The Level's name, or "Custom · N privileges" for a grant that matches none. */
  level: string;
  /** Can share, Agent limits: the modifiers, one fact each. */
  details: string[];
  /** Who made the grant; null where that is not known (a Member's own view). */
  grantedBy: string | null;
  /** What this grant reaches the group through ("Team QC", "Host LongPro2Max");
   * such a row is edited where it is granted. */
  via: string | null;
  /** The grant to edit or remove; null for a row shown through a Team. */
  assignment: AccessAssignment | null;
  /** Above the viewer's own level: shown, not changeable. */
  locked: boolean;
}

export interface GrantGroup {
  key: string;
  title: string;
  /** What the group is: "Team · 3 Members", "Member", "Project · LongPro2Max". */
  subtitle: string;
  rows: GrantRow[];
}

export interface GrantRowInput {
  assignments: readonly AccessAssignment[];
  resources: readonly AccessResource[];
  members: readonly HubMember[];
  teams: readonly HubTeam[];
  memberNameByUserId: ReadonlyMap<string, string>;
  levelLabel(assignment: AccessAssignment): string;
  sharesAccess(assignment: AccessAssignment): boolean;
  locked(assignment: AccessAssignment): boolean;
}

/** One row per stored grant. */
export function grantRows(input: GrantRowInput): GrantRow[] {
  const resourceByKey = new Map(
    input.resources.map((resource) => [resourceKey(resource), resource]),
  );
  return input.assignments.map((assignment) => ({
    key: assignment.id,
    subject: {
      kind: assignment.subjectKind,
      id: assignment.subjectId,
      name: subjectName(assignment.subjectKind, assignment.subjectId, input),
    },
    resource: resourceCell(assignment, resourceByKey),
    level: input.levelLabel(assignment),
    details: grantDetails(assignment, input.sharesAccess(assignment)),
    grantedBy: grantorName(assignment, input.memberNameByUserId),
    via: null,
    assignment,
    locked: input.locked(assignment),
  }));
}

function grantDetails(assignment: AccessAssignment, canShare: boolean): string[] {
  const limits = constraintSummary(assignment.constraints);
  return [...(canShare ? ["Can share"] : []), ...(limits === null ? [] : [limits])];
}

function subjectName(kind: SubjectKind, id: string, input: GrantRowInput): string {
  if (kind === "guest") return "Guest";
  if (kind === "team")
    return input.teams.find((team) => team.id === id)?.name ?? "Unavailable Team";
  return input.members.find((member) => member.id === id)?.name ?? "Former Member";
}

function resourceCell(
  assignment: AccessAssignment,
  resourceByKey: ReadonlyMap<string, AccessResource>,
): GrantRow["resource"] {
  const resource = resourceByKey.get(
    resourceKey({ kind: assignment.resourceKind, id: assignment.resourceId }),
  );
  const parent = resource?.parent ? resourceByKey.get(resourceKey(resource.parent)) : undefined;
  const kind = resourceKindLabel(assignment.resourceKind);
  return {
    kind: assignment.resourceKind,
    id: assignment.resourceId,
    name: resource?.name ?? assignment.resourceId,
    context: parent === undefined ? kind : `${kind} · ${parent.name}`,
  };
}

export interface GrantDirectory {
  members: readonly HubMember[];
  teams: readonly HubTeam[];
  resources: readonly AccessResource[];
}

/**
 * Grouped by who holds the grants or by what they are on. Grouped by people, a
 * Member's group also lists what their Teams give them; grouped by resource, a
 * Project lists the Host grants that reach it.
 */
export function groupGrantRows(
  rows: readonly GrantRow[],
  grouping: GrantGrouping,
  directory: GrantDirectory,
): GrantGroup[] {
  const groups =
    grouping === "subject" ? subjectGroups(rows, directory) : resourceGroups(rows, directory);
  for (const group of groups) group.rows = sortGrantRows(group.rows, grouping);
  return groups;
}

function subjectGroups(
  rows: readonly GrantRow[],
  directory: { members: readonly HubMember[]; teams: readonly HubTeam[] },
): GrantGroup[] {
  const groups = new Map<string, GrantGroup>();
  for (const row of rows) {
    const key = `${row.subject.kind}:${row.subject.id}`;
    const group = groups.get(key) ?? {
      key,
      title: row.subject.name,
      subtitle: subjectSubtitle(row.subject, directory),
      rows: [],
    };
    group.rows.push(row);
    groups.set(key, group);
  }
  addTeamRowsToMembers(groups, rows, directory);
  return [...groups.values()].sort(bySubjectOrder);
}

/**
 * A Member's Team grants, under the Member. A Member whose only access comes
 * through Teams still gets a group: "what can this person use" has an answer.
 */
function addTeamRowsToMembers(
  groups: Map<string, GrantGroup>,
  rows: readonly GrantRow[],
  directory: { members: readonly HubMember[]; teams: readonly HubTeam[] },
): void {
  for (const member of directory.members) {
    const key = `member:${member.id}`;
    const teams = directory.teams.filter((team) => team.userIds.includes(member.userId));
    const inherited = teams.flatMap((team) =>
      rows
        .filter((row) => row.subject.kind === "team" && row.subject.id === team.id)
        .map((row) => reached(row, `${row.key}:${member.id}`, `Team ${team.name}`)),
    );
    if (inherited.length === 0 && !groups.has(key)) continue;
    const group = groups.get(key) ?? { key, title: member.name, subtitle: "Member", rows: [] };
    group.rows.push(...inherited);
    groups.set(key, group);
  }
}

function subjectSubtitle(
  subject: GrantRow["subject"],
  directory: { members: readonly HubMember[]; teams: readonly HubTeam[] },
): string {
  if (subject.kind === "guest") return "Channel senders without a linked Member";
  if (subject.kind === "member") return "Member";
  const count = directory.teams.find((team) => team.id === subject.id)?.userIds.length ?? 0;
  return `Team · ${String(count)} Member${count === 1 ? "" : "s"}`;
}

const SUBJECT_ORDER: Record<SubjectKind, number> = { team: 0, member: 1, guest: 2 };

function bySubjectOrder(left: GrantGroup, right: GrantGroup): number {
  // The key says what the group is; a Member's first row may come through a Team.
  const kind = (group: GrantGroup) =>
    SUBJECT_ORDER[(group.key.split(":")[0] ?? "member") as SubjectKind] ?? 1;
  return kind(left) - kind(right) || left.title.localeCompare(right.title);
}

/** A grant shown where it reaches, not where it is granted: not editable there. */
function reached(row: GrantRow, key: string, via: string): GrantRow {
  return Object.assign({}, row, { key, via, assignment: null });
}

/**
 * A Project is also used through a Host grant that carries Project use, so the
 * Project lists those too ("via Host …"). A Project reached only that way still
 * gets a group: it is not a Project without access.
 */
function addHostRowsToProjects(
  groups: Map<string, GrantGroup>,
  rows: readonly GrantRow[],
  resources: readonly AccessResource[],
): void {
  for (const project of resources) {
    if (project.kind !== "project" || project.parent?.kind !== "daemon") continue;
    const key = `project:${project.id}`;
    const hostId = project.parent.id;
    const reachedRows = rows
      .filter(
        (row) =>
          row.resource.kind === "daemon" &&
          row.resource.id === hostId &&
          row.assignment?.privileges.includes("project.use") === true,
      )
      .map((row) => reached(row, `${row.key}:${project.id}`, `Host ${row.resource.name}`));
    if (reachedRows.length === 0 && !groups.has(key)) continue;
    const group = groups.get(key) ?? {
      key,
      title: project.name,
      subtitle: `Project · ${resources.find(({ kind, id }) => kind === "daemon" && id === hostId)?.name ?? hostId}`,
      rows: [],
    };
    group.rows.push(...reachedRows);
    groups.set(key, group);
  }
}

function resourceGroups(rows: readonly GrantRow[], directory: GrantDirectory): GrantGroup[] {
  const { resources } = directory;
  const groups = new Map<string, GrantGroup>();
  for (const row of rows) {
    const key = `${row.resource.kind}:${row.resource.id}`;
    const group = groups.get(key) ?? {
      key,
      title: row.resource.name,
      subtitle: row.resource.context,
      rows: [],
    };
    group.rows.push(row);
    groups.set(key, group);
  }
  addHostRowsToProjects(groups, rows, resources);
  return [...groups.values()].sort(byResourceOrder);
}

const RESOURCE_ORDER: Partial<Record<AccessResourceKind, number>> = {
  daemon: 0,
  project: 1,
  team: 2,
  channel_account: 3,
  automation: 4,
};

function byResourceOrder(left: GrantGroup, right: GrantGroup): number {
  // The key says what the group is; a Project's first row may come through its Host.
  const kind = (group: GrantGroup) =>
    RESOURCE_ORDER[(group.key.split(":")[0] ?? "daemon") as AccessResourceKind] ?? 9;
  return kind(left) - kind(right) || left.title.localeCompare(right.title);
}

/** A subject's grants by resource, a resource's by who holds them; direct and via stay adjacent. */
export function sortGrantRows(rows: readonly GrantRow[], grouping: GrantGrouping): GrantRow[] {
  const order = (row: GrantRow) =>
    grouping === "subject"
      ? (RESOURCE_ORDER[row.resource.kind] ?? 9)
      : SUBJECT_ORDER[row.subject.kind];
  const name = (row: GrantRow) => (grouping === "subject" ? row.resource.name : row.subject.name);
  return [...rows].sort(
    (left, right) =>
      order(left) - order(right) ||
      name(left).localeCompare(name(right)) ||
      Number(left.via !== null) - Number(right.via !== null),
  );
}

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
 * The Level's name when the grant still equals one. A custom grant is counted,
 * not listed: its privileges are read in the grant sheet, not in a table cell.
 */
export function grantedAccessLabel(
  assignment: Pick<AccessAssignment, "resourceKind" | "privileges">,
  accessLevels: AccessCatalog["accessLevels"],
): string {
  const level = matchingAccessLevel(accessLevels, assignment.resourceKind, assignment.privileges);
  if (level === undefined) {
    return `Custom · ${countLabel(assignment.privileges.length, "privilege")}`;
  }
  const fastMode = assignment.privileges.includes("agent.fast.use") ? " + Fast mode" : "";
  return `${accessLevelLabel(level)}${fastMode}`;
}

/** Above the viewer's own level on that resource: shown, not changeable. */
export function aboveViewer(
  assignment: AccessAssignment,
  authority: ViewerAuthority,
  resources: readonly AccessResource[],
): boolean {
  const resource = resources.find(
    (candidate) =>
      candidate.kind === assignment.resourceKind && candidate.id === assignment.resourceId,
  ) ?? { kind: assignment.resourceKind, id: assignment.resourceId, parent: null };
  return !privilegesWithinHoldings(
    viewerHoldings(authority, resource, resources),
    assignment.privileges,
  );
}

/**
 * A Member's own effective access as rows (read-only): direct grants and the
 * ones their Teams give them. Who made each grant is not part of this view.
 */
export function effectiveGrantRows(
  grants: readonly {
    assignmentId: string;
    resource: AccessResource;
    privileges: readonly string[];
    constraints: Record<string, unknown>;
    source: { kind: "direct" } | { kind: "team"; teamName: string };
  }[],
  resources: readonly AccessResource[],
  accessLevels: AccessCatalog["accessLevels"] | undefined,
): GrantRow[] {
  return grants.map((grant) => {
    const parent = grant.resource.parent
      ? resources.find(
          (candidate) =>
            candidate.kind === grant.resource.parent?.kind &&
            candidate.id === grant.resource.parent.id,
        )
      : undefined;
    const kind = resourceKindLabel(grant.resource.kind);
    const limits = constraintSummary(grant.constraints);
    return {
      key: `${grant.assignmentId}:${grant.source.kind}`,
      subject: { kind: "member", id: "self", name: "You" },
      resource: {
        kind: grant.resource.kind,
        id: grant.resource.id,
        name: grant.resource.name,
        context: [
          parent === undefined ? kind : `${kind} · ${parent.name}`,
          ...(grant.resource.available ? [] : ["Unavailable"]),
        ].join(" · "),
      },
      level: effectiveLevel(grant.resource.kind, grant.privileges, accessLevels),
      details: limits === null ? [] : [limits],
      grantedBy: null,
      via: grant.source.kind === "team" ? `Team ${grant.source.teamName}` : null,
      assignment: null,
      locked: false,
    };
  });
}

function effectiveLevel(
  resourceKind: AccessResourceKind,
  privileges: readonly string[],
  accessLevels: AccessCatalog["accessLevels"] | undefined,
): string {
  if (accessLevels !== undefined)
    return grantedAccessLabel({ resourceKind, privileges: [...privileges] }, accessLevels);
  // COMPAT(effective-access-levels): added 2026-09-19, remove after 2027-03-19.
  // A Hub without the Level catalog on effective access: name the privileges.
  return countLabel(privileges.length, "privilege");
}

/** One subject's grants: a Team's, or a Member's own and their Teams'. */
export function subjectGrantRows(
  rows: readonly GrantRow[],
  subject: { kind: SubjectKind; id: string },
  directory: GrantDirectory,
): GrantRow[] {
  const key = `${subject.kind}:${subject.id}`;
  return groupGrantRows(rows, "subject", directory).find((group) => group.key === key)?.rows ?? [];
}
