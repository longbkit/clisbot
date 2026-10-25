import {
  scoreTextFields,
  tokenizeQuery,
  type MatchScore,
} from "@clisbot/protocol/search/text-match";
import type { ScopeHost, ScopeHub, ScopeProject, SearchScopeCatalog } from "./catalog";
import {
  foldSearchText,
  searchScopeChipId,
  type ResolvedSearchScope,
  type SearchScopeChip,
} from "./model";

/** The list filter of the section search was opened from (R1). It ranks; it never hides. */
export interface SearchViewContext {
  label: string;
  serverIds: ReadonlySet<string> | null;
  projectKeys: ReadonlySet<string> | null;
}

export type ScopeCandidate =
  | { kind: "hub"; hub: ScopeHub; outOfScope: boolean }
  | { kind: "host"; host: ScopeHost; outOfScope: boolean }
  /** `serverId` set: the project on that Host, which adds two chips. */
  | { kind: "project"; project: ScopeProject; serverId: string | null; outOfScope: boolean };

export interface ScopeCandidates {
  projects: ScopeCandidate[];
  hosts: ScopeCandidate[];
}

export const SCOPE_SECTION_LIMIT = 6;
const PER_HOST_PROJECT_LIMIT = 3;
/** A project on this few Hosts lists each placement under its merged row. */
const SMALL_PROJECT_SPREAD = 3;

interface Ranked<T> {
  item: T;
  score: MatchScore | null;
  inView: boolean;
  outOfScope: boolean;
  online: boolean;
  label: string;
}

function compareRanked<T>(left: Ranked<T>, right: Ranked<T>): number {
  return (
    Number(right.inView) - Number(left.inView) ||
    Number(left.outOfScope) - Number(right.outOfScope) ||
    (left.score?.tier ?? 0) - (right.score?.tier ?? 0) ||
    (left.score?.offset ?? 0) - (right.score?.offset ?? 0) ||
    Number(right.online) - Number(left.online) ||
    left.label.localeCompare(right.label)
  );
}

interface CandidateInput {
  catalog: SearchScopeCatalog;
  query: string;
  chips: readonly SearchScopeChip[];
  scope: ResolvedSearchScope;
  view: SearchViewContext | null;
}

function hostOutOfScope(host: ScopeHost, scope: ResolvedSearchScope): boolean {
  if (!scope.projectKeys) return false;
  for (const key of scope.projectKeys) if (host.projectKeys.has(key)) return false;
  return true;
}

function projectOutOfScope(project: ScopeProject, scope: ResolvedSearchScope): boolean {
  if (!scope.serverIds) return false;
  return !project.serverIds.some((id) => scope.serverIds?.has(id));
}

function projectInView(project: ScopeProject, view: SearchViewContext | null): boolean {
  if (!view) return false;
  if (view.projectKeys?.has(project.key)) return true;
  return view.serverIds !== null && project.serverIds.some((id) => view.serverIds?.has(id));
}

function hostCandidates(input: CandidateInput, folded: string): ScopeCandidate[] {
  const chipIds = new Set(input.chips.map(searchScopeChipId));
  const ranked: Ranked<ScopeCandidate>[] = [];
  for (const hub of input.catalog.hubs) {
    if (chipIds.has(`hub:${hub.origin}`)) continue;
    const score = scoreTextFields(folded, [...hub.fields]);
    if (!score) continue;
    const hosts = hub.serverIds.flatMap((id) => input.catalog.hostById.get(id) ?? []);
    const outOfScope = hosts.every((host) => hostOutOfScope(host, input.scope));
    ranked.push({
      item: { kind: "hub", hub, outOfScope },
      score,
      inView: Boolean(
        input.view?.serverIds && hub.serverIds.some((id) => input.view?.serverIds?.has(id)),
      ),
      outOfScope,
      online: hub.onlineCount > 0,
      // Ties go to the Hub: it is the wider choice and there is one per many Hosts.
      label: `\u0000${hub.name}`,
    });
  }
  for (const host of input.catalog.hosts) {
    if (chipIds.has(`host:${host.serverId}`)) continue;
    const score = scoreTextFields(folded, [...host.fields]);
    if (!score) continue;
    const outOfScope = hostOutOfScope(host, input.scope);
    ranked.push({
      item: { kind: "host", host, outOfScope },
      score,
      inView: input.view?.serverIds?.has(host.serverId) ?? false,
      outOfScope,
      online: host.status === "online",
      label: host.label,
    });
  }
  return ranked
    .sort(compareRanked)
    .slice(0, SCOPE_SECTION_LIMIT)
    .map((entry) => entry.item);
}

/** Tokens that only a Host field matched: the user named a Host inside a project query. */
function hostOnlyTokens(tokens: readonly string[], project: ScopeProject): string[] {
  return tokens.filter((token) => !scoreTextFields(token, [...project.fields]));
}

function placementRows(
  input: CandidateInput,
  project: ScopeProject,
  tokens: readonly string[],
): ScopeCandidate[] {
  if (input.scope.serverIds) return [];
  const hostTokens = hostOnlyTokens(tokens, project);
  if (hostTokens.length === 0 && project.serverIds.length > SMALL_PROJECT_SPREAD) return [];
  if (project.serverIds.length < 2) return [];
  const rows: Ranked<ScopeCandidate>[] = [];
  for (const serverId of project.serverIds) {
    const host = input.catalog.hostById.get(serverId);
    if (!host) continue;
    const score =
      hostTokens.length > 0 ? scoreTextFields(hostTokens.join(" "), [...host.fields]) : null;
    if (hostTokens.length > 0 && !score) continue;
    rows.push({
      item: { kind: "project", project, serverId, outOfScope: false },
      score,
      inView: input.view?.serverIds?.has(serverId) ?? false,
      outOfScope: false,
      online: host.status === "online",
      label: host.label,
    });
  }
  return rows
    .sort(compareRanked)
    .slice(0, PER_HOST_PROJECT_LIMIT)
    .map((row) => row.item);
}

/** A project's score is its own match, or failing that the best of its Host placements. */
function scoreProject(
  input: CandidateInput,
  project: ScopeProject,
  folded: string,
  tokens: string[],
) {
  const own = scoreTextFields(folded, [...project.fields]);
  if (own || tokens.length < 2) return own;
  let best: MatchScore | null = null;
  for (const serverId of project.serverIds) {
    const host = input.catalog.hostById.get(serverId);
    if (!host) continue;
    const score = scoreTextFields(folded, [...project.fields, ...host.fields]);
    if (score && (!best || score.tier < best.tier)) best = score;
  }
  return best;
}

function projectCandidates(input: CandidateInput, folded: string): ScopeCandidate[] {
  const tokens = tokenizeQuery(folded);
  const ranked: Ranked<ScopeProject>[] = [];
  for (const project of input.catalog.projects) {
    if (input.scope.projectKeys?.has(project.key)) continue;
    const score = scoreProject(input, project, folded, tokens);
    if (!score) continue;
    ranked.push({
      item: project,
      score,
      inView: projectInView(project, input.view),
      outOfScope: projectOutOfScope(project, input.scope),
      online: true,
      label: project.label,
    });
  }
  ranked.sort(compareRanked);
  const rows: ScopeCandidate[] = [];
  for (const entry of ranked) {
    if (rows.length >= SCOPE_SECTION_LIMIT) break;
    rows.push({
      kind: "project",
      project: entry.item,
      serverId: null,
      outOfScope: entry.outOfScope,
    });
    rows.push(...placementRows(input, entry.item, tokens));
  }
  return rows.slice(0, SCOPE_SECTION_LIMIT);
}

/** With chips and nothing typed, suggest the other dimension inside the scope (cases 7–8). */
function emptyQueryCandidates(input: CandidateInput): ScopeCandidates {
  const { catalog, scope } = input;
  if (scope.serverIds && !scope.projectKeys) {
    const serverIds = scope.serverIds;
    const inScopeSessions = (project: ScopeProject) =>
      project.serverIds.reduce(
        (sum, id) => sum + (serverIds.has(id) ? (project.sessionCountByServerId.get(id) ?? 0) : 0),
        0,
      );
    const projects = catalog.projects
      .filter((project) => project.serverIds.some((id) => serverIds.has(id)))
      .sort((a, b) => inScopeSessions(b) - inScopeSessions(a) || a.label.localeCompare(b.label))
      .slice(0, SCOPE_SECTION_LIMIT)
      .map<ScopeCandidate>((project) => ({
        kind: "project",
        project,
        serverId: null,
        outOfScope: false,
      }));
    return { projects, hosts: [] };
  }
  if (scope.projectKeys && !scope.serverIds) {
    const hosts = catalog.hosts
      .filter((host) => !hostOutOfScope(host, scope))
      .sort((a, b) => Number(b.status === "online") - Number(a.status === "online"))
      .slice(0, SCOPE_SECTION_LIMIT)
      .map<ScopeCandidate>((host) => ({ kind: "host", host, outOfScope: false }));
    return { projects: [], hosts };
  }
  return { projects: [], hosts: [] };
}

export function findScopeCandidates(input: CandidateInput): ScopeCandidates {
  const folded = foldSearchText(input.query.trim());
  if (!folded) return emptyQueryCandidates(input);
  return { projects: projectCandidates(input, folded), hosts: hostCandidates(input, folded) };
}
