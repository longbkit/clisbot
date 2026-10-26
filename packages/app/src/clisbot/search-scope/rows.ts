import type { ScopeCandidate } from "./candidates";
import type { ScopeHost, ScopeHostStatus, ScopeHub, SearchScopeCatalog } from "./catalog";
import type { OpenInWorkTarget } from "./work-navigation";
import type { SearchScopeChip } from "./model";

/** What one scope row draws. Pure data, so the case tests read it without rendering. */
export interface ScopeRowModel {
  id: string;
  icon: "host" | "local" | "hub" | "project" | "remove" | "everywhere";
  title: string;
  /** Matched and highlighted against the query. */
  subtitle: string;
  /** Muted, never highlighted: status the query cannot match. */
  note: string | null;
  status: ScopeHostStatus | null;
  /** The chips Enter adds; empty for the empty-state actions. */
  chips: SearchScopeChip[];
  /** Null when the row has no "Show in Work". */
  workTarget: OpenInWorkTarget | null;
  testID: string;
}

export type ScopeT = (key: string, options?: Record<string, unknown>) => string;

export interface RowContext {
  catalog: SearchScopeCatalog;
  t: ScopeT;
  formatTime(iso: string): string;
  /** Project chips in place, so a Host row can say which one it lacks. */
  projectChipKeys: readonly string[];
}

function join(parts: readonly (string | null | undefined | false)[]): string {
  return parts.filter((part): part is string => Boolean(part)).join(" · ");
}

/** "sandbox-12", or "build · Company" when another visible Host is also called "build". */
export function hostChipLabel(host: ScopeHost, catalog: SearchScopeCatalog): string {
  const twins = catalog.hosts.filter((other) => other.label === host.label).length;
  if (twins < 2) return host.label;
  return join([host.label, host.hubName ?? null, host.shortId]);
}

function hostSource(host: ScopeHost, t: ScopeT): string {
  if (host.local) return t("host.thisComputer");
  return host.hubName ?? t("host.direct");
}

export function hostStatusText(host: ScopeHost, context: RowContext): string {
  if (host.status === "online") return context.t("host.online");
  if (host.status === "connecting") return context.t("host.connecting");
  return host.lastOnlineAt
    ? context.t("host.lastOnline", { time: context.formatTime(host.lastOnlineAt) })
    : context.t("host.offline");
}

function hostRow(
  candidate: Extract<ScopeCandidate, { kind: "host" }>,
  context: RowContext,
): ScopeRowModel {
  const { host } = candidate;
  const { t, catalog } = context;
  const blocked = candidate.outOfScope
    ? t("host.noProject", { project: missingProjectLabel(host, context) })
    : null;
  return {
    id: `scope:host:${host.serverId}`,
    icon: host.local ? "local" : "host",
    title: host.label,
    subtitle: join([hostSource(host, t), host.shortId, ...host.hostnames.slice(0, 1)]),
    note: join([
      blocked,
      hostStatusText(host, context),
      t("sessions", { count: host.sessionCount }),
    ]),
    status: host.status,
    chips: [{ kind: "host", serverId: host.serverId, label: hostChipLabel(host, catalog) }],
    workTarget: { serverIds: [host.serverId], projectNames: [], projectViewKeys: [] },
    testID: `command-center-scope-host-${host.serverId}`,
  };
}

/** The first Project chip this Host does not carry. */
function missingProjectLabel(host: ScopeHost, context: RowContext): string {
  const key = context.projectChipKeys.find((entry) => !host.projectKeys.has(entry));
  return (key && context.catalog.projectByKey.get(key)?.label) ?? "";
}

function hubRow(hub: ScopeHub, context: RowContext): ScopeRowModel {
  const { t } = context;
  // Signed in, but no Host is shared with the reader yet: findable, and the note says why there
  // is nothing under it — there is no Workspace list to show it in.
  if (hub.serverIds.length === 0)
    return {
      id: `scope:hub:${hub.origin}`,
      icon: "hub",
      title: hub.name,
      subtitle: "Hub",
      note: t("hubRow.noHosts"),
      status: "offline",
      chips: [{ kind: "hub", origin: hub.origin, label: hub.name }],
      workTarget: null,
      testID: `command-center-scope-hub-${hub.origin}`,
    };
  return {
    id: `scope:hub:${hub.origin}`,
    icon: "hub",
    title: hub.name,
    subtitle: "Hub",
    note: join([
      t("hubRow.hosts", { count: hub.serverIds.length }),
      t("hubRow.online", { count: hub.onlineCount }),
    ]),
    status: hub.onlineCount > 0 ? "online" : "offline",
    chips: [{ kind: "hub", origin: hub.origin, label: hub.name }],
    workTarget: { serverIds: [...hub.serverIds], projectNames: [], projectViewKeys: [] },
    testID: `command-center-scope-hub-${hub.origin}`,
  };
}

function projectRow(
  candidate: Extract<ScopeCandidate, { kind: "project" }>,
  context: RowContext,
): ScopeRowModel {
  const { project, serverId } = candidate;
  const { t, catalog } = context;
  const projectChip: SearchScopeChip = { kind: "project", key: project.key, label: project.label };
  const target = { projectNames: [project.label], projectViewKeys: [...project.viewKeys] };
  if (serverId) {
    const host = catalog.hostById.get(serverId);
    const label = host ? hostChipLabel(host, catalog) : serverId;
    return {
      id: `scope:project:${project.key}:${serverId}`,
      icon: "project",
      title: project.label,
      subtitle: t("project.onHost", { host: label }),
      note: join([
        host && host.status !== "online" && hostStatusText(host, context),
        t("sessions", { count: project.sessionCountByServerId.get(serverId) ?? 0 }),
      ]),
      status: host?.status ?? null,
      chips: [{ kind: "host", serverId, label }, projectChip],
      workTarget: { serverIds: [serverId], ...target },
      testID: `command-center-scope-project-${project.key}-${serverId}`,
    };
  }
  const single =
    project.serverIds.length === 1 ? catalog.hostById.get(project.serverIds[0]!) : null;
  return {
    id: `scope:project:${project.key}`,
    icon: "project",
    title: project.label,
    subtitle: single
      ? t("project.onHost", { host: hostChipLabel(single, catalog) })
      : t("project.onHosts", { count: project.serverIds.length }),
    note: join([
      candidate.outOfScope && t("project.notInScope"),
      t("sessions", { count: project.sessionCount }),
    ]),
    status: null,
    chips: [projectChip],
    workTarget: { serverIds: [], ...target },
    testID: `command-center-scope-project-${project.key}`,
  };
}

export function buildScopeRows(
  candidates: readonly ScopeCandidate[],
  context: RowContext,
): ScopeRowModel[] {
  return candidates.map((candidate) => {
    if (candidate.kind === "host") return hostRow(candidate, context);
    if (candidate.kind === "hub") return hubRow(candidate.hub, context);
    return projectRow(candidate, context);
  });
}

/** What the chips say together, for the empty state: "sandbox-12 · clisbot". */
export function scopeLabel(chips: readonly SearchScopeChip[]): string {
  return join(chips.map((chip) => chip.label));
}

/** Nothing in scope matched (R6): say so, and offer the ways out as rows Enter can take. */
export function buildEmptyStateRows(
  chips: readonly SearchScopeChip[],
  query: string,
  t: ScopeT,
): { title: string; rows: ScopeRowModel[] } {
  const scope = scopeLabel(chips);
  const title = query.trim()
    ? t("empty.noMatchesIn", { query: query.trim(), scope })
    : t("empty.nothingIn", { scope });
  const hasHost = chips.some((chip) => chip.kind !== "project");
  const hasProject = chips.some((chip) => chip.kind === "project");
  const action = (id: string, icon: ScopeRowModel["icon"], label: string): ScopeRowModel => ({
    id: `scope:empty:${id}`,
    icon,
    title: label,
    subtitle: "",
    note: null,
    status: null,
    chips: [],
    workTarget: null,
    testID: `command-center-scope-empty-${id}`,
  });
  const rows: ScopeRowModel[] = [];
  if (hasHost) rows.push(action("remove-host", "remove", t("empty.removeHostFilter")));
  if (hasProject) rows.push(action("remove-project", "remove", t("empty.removeProjectFilter")));
  // With one dimension, removing it already is "everywhere"; two rows doing one thing is clutter.
  if (hasHost && hasProject)
    rows.push(action("everywhere", "everywhere", t("empty.searchEverywhere")));
  return { title, rows };
}
