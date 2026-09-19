// The Access screen's master list as data: one entry per person, Team, or
// resource, each with the grants its detail shows. Built to stay readable at
// hundreds of Members: the list is filtered by kind and search, and only one
// entry's grants are ever on screen. docs/features/access/access-screen.md.

import {
  resourceKey,
  resourceKindLabel,
  subjectKey,
  type AccessResource,
  type AccessResourceKind,
  type SubjectKind,
} from "./access-catalog";
import {
  groupGrantRows,
  type GrantDirectory,
  type GrantGrouping,
  type GrantRow,
} from "./access-grant-rows";

export interface AccessEntry {
  /** `member:<id>`, `daemon:<id>`: the same key as its grant group. */
  key: string;
  kind: SubjectKind | AccessResourceKind;
  title: string;
  subtitle: string;
  rows: GrantRow[];
  /** What the grant sheet opens on for this entry. */
  target: { subject: string | null; resource: string | null };
}

/** "all" is every entry with access; "none" every entry without; the rest a kind. */
export type EntryFilter = "all" | "none" | SubjectKind | AccessResourceKind;

export interface EntryFilterChip {
  value: EntryFilter;
  label: string;
  count: number;
}

const SUBJECT_KINDS: readonly SubjectKind[] = ["team", "member", "guest"];
const RESOURCE_KINDS: readonly AccessResourceKind[] = [
  "daemon",
  "project",
  "team",
  "channel_account",
  "automation",
];
const SUBJECT_FILTER_LABELS: Record<SubjectKind, string> = {
  team: "Teams",
  member: "Members",
  guest: "Guest",
};
const RESOURCE_FILTER_LABELS: Partial<Record<AccessResourceKind, string>> = {
  daemon: "Hosts",
  project: "Projects",
  channel_account: "Connections",
  team: "Teams",
  automation: "Automations",
};

/** Every entry of one view: the ones with grants, then the ones without. */
export function accessEntries(
  rows: readonly GrantRow[],
  grouping: GrantGrouping,
  directory: GrantDirectory,
): AccessEntry[] {
  const emailById = new Map(directory.members.map((member) => [member.id, member.email]));
  const withAccess = groupGrantRows(rows, grouping, directory).map((group) => ({
    key: group.key,
    kind: group.key.split(":")[0] as AccessEntry["kind"],
    title: group.title,
    // Among hundreds of Members, the email tells two of the same name apart.
    subtitle: group.key.startsWith("member:")
      ? (emailById.get(group.key.slice("member:".length)) ?? group.subtitle)
      : group.subtitle,
    rows: group.rows,
    target: targetOf(group.key, grouping),
  }));
  const listed = new Set(withAccess.map(({ key }) => key));
  const without = (
    grouping === "subject" ? subjectsWithout(directory) : resourcesWithout(directory.resources)
  ).filter(({ key }) => !listed.has(key));
  return [...withAccess, ...without];
}

function targetOf(key: string, grouping: GrantGrouping): AccessEntry["target"] {
  const [kind = "", id = ""] = key.split(":");
  return grouping === "subject"
    ? { subject: subjectKey(kind as SubjectKind, id), resource: null }
    : { subject: null, resource: resourceKey({ kind: kind as AccessResourceKind, id }) };
}

function entryWithout(
  kind: AccessEntry["kind"],
  id: string,
  title: string,
  subtitle: string,
  grouping: GrantGrouping,
): AccessEntry {
  const key = `${kind}:${id}`;
  return { key, kind, title, subtitle, rows: [], target: targetOf(key, grouping) };
}

function subjectsWithout(directory: GrantDirectory): AccessEntry[] {
  return [
    ...directory.teams.map((team) => entryWithout("team", team.id, team.name, "Team", "subject")),
    ...directory.members.map((member) =>
      entryWithout("member", member.id, member.name, member.email, "subject"),
    ),
    entryWithout("guest", "guest", "Guest", "Channel senders without a linked Member", "subject"),
  ];
}

function resourcesWithout(resources: readonly AccessResource[]): AccessEntry[] {
  return resources
    .filter((resource) => RESOURCE_FILTER_LABELS[resource.kind] !== undefined)
    .map((resource) =>
      entryWithout(
        resource.kind,
        resource.id,
        resource.name,
        resourceKindLabel(resource.kind),
        "resource",
      ),
    );
}

/** The chips over the list: every kind present, then "No access". */
export function entryFilterChips(
  entries: readonly AccessEntry[],
  grouping: GrantGrouping,
): EntryFilterChip[] {
  const withAccess = entries.filter(({ rows }) => rows.length > 0);
  const kinds: readonly AccessEntry["kind"][] =
    grouping === "subject" ? SUBJECT_KINDS : RESOURCE_KINDS;
  const labels: Partial<Record<string, string>> =
    grouping === "subject" ? SUBJECT_FILTER_LABELS : RESOURCE_FILTER_LABELS;
  const byKind = kinds.flatMap((kind) => {
    const count = withAccess.filter((entry) => entry.kind === kind).length;
    return count === 0 ? [] : [{ value: kind, label: labels[kind] ?? kind, count }];
  });
  return [
    { value: "all", label: "With access", count: withAccess.length },
    ...byKind,
    { value: "none", label: "No access", count: entries.length - withAccess.length },
  ];
}

export function filterEntries(
  entries: readonly AccessEntry[],
  filter: EntryFilter,
  search: string,
): AccessEntry[] {
  const query = search.trim().toLowerCase();
  return entries.filter((entry) => {
    const hasAccess = entry.rows.length > 0;
    const inFilter =
      filter === "none" ? !hasAccess : hasAccess && (filter === "all" || entry.kind === filter);
    if (!inFilter) return false;
    return (
      query.length === 0 ||
      entry.title.toLowerCase().includes(query) ||
      entry.subtitle.toLowerCase().includes(query)
    );
  });
}
