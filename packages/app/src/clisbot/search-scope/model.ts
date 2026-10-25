/**
 * Search scope chips (docs/features/global-search/README.md). Two dimensions: the Host set (Host
 * and Hub chips) and the Project set (Project chips, keyed by folded project name). OR within a
 * dimension, AND across.
 */
export type SearchScopeChip =
  | { kind: "host"; serverId: string; label: string }
  | { kind: "hub"; origin: string; label: string }
  | { kind: "project"; key: string; label: string };

export interface ResolvedSearchScope {
  /** Null when no Host or Hub chip is set: every Host. */
  serverIds: ReadonlySet<string> | null;
  /** Null when no Project chip is set: every project. */
  projectKeys: ReadonlySet<string> | null;
}

export const UNSCOPED: ResolvedSearchScope = { serverIds: null, projectKeys: null };

export function searchScopeChipId(chip: SearchScopeChip): string {
  if (chip.kind === "host") return `host:${chip.serverId}`;
  if (chip.kind === "hub") return `hub:${chip.origin}`;
  return `project:${chip.key}`;
}

/** Append chips not already present. Adding never replaces: OR within a dimension (R5). */
export function addSearchScopeChips(
  chips: readonly SearchScopeChip[],
  added: readonly SearchScopeChip[],
): SearchScopeChip[] {
  const ids = new Set(chips.map(searchScopeChipId));
  const next = [...chips];
  for (const chip of added) {
    const id = searchScopeChipId(chip);
    if (ids.has(id)) continue;
    ids.add(id);
    next.push(chip);
  }
  return next;
}

export function removeSearchScopeChip(
  chips: readonly SearchScopeChip[],
  id: string,
): SearchScopeChip[] {
  return chips.filter((chip) => searchScopeChipId(chip) !== id);
}

/** A Hub chip stands for every Host that Hub lists, as of now. */
export function resolveSearchScope(
  chips: readonly SearchScopeChip[],
  serverIdsByHub: ReadonlyMap<string, readonly string[]>,
): ResolvedSearchScope {
  if (chips.length === 0) return UNSCOPED;
  let serverIds: Set<string> | null = null;
  let projectKeys: Set<string> | null = null;
  for (const chip of chips) {
    if (chip.kind === "project") {
      projectKeys ??= new Set();
      projectKeys.add(chip.key);
      continue;
    }
    serverIds ??= new Set();
    if (chip.kind === "host") serverIds.add(chip.serverId);
    else for (const id of serverIdsByHub.get(chip.origin) ?? []) serverIds.add(id);
  }
  return { serverIds, projectKeys };
}

export function isScoped(scope: ResolvedSearchScope): boolean {
  return scope.serverIds !== null || scope.projectKeys !== null;
}

export function inSearchScope(
  scope: ResolvedSearchScope,
  serverId: string,
  projectKey: string | null,
): boolean {
  if (scope.serverIds && !scope.serverIds.has(serverId)) return false;
  if (scope.projectKeys && (projectKey === null || !scope.projectKeys.has(projectKey)))
    return false;
  return true;
}

const COMBINING_MARKS = /\p{M}/gu;

/**
 * Case- and diacritics-insensitive text, so `may cua long` finds "Máy của Long". NFC input keeps
 * its length (one base letter per precomposed letter), so match offsets on folded text still
 * index the displayed text.
 */
export function foldSearchText(text: string): string {
  return text
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .replace(/[đĐ]/g, "d")
    .normalize("NFC")
    .toLowerCase();
}

/** One project identity across Hosts: its folded display name. */
export function projectNameKey(name: string): string {
  return foldSearchText(name.trim());
}
