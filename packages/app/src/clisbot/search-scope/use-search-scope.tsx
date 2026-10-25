import { useCallback, useLayoutEffect, useMemo } from "react";
import type {
  CommandCenterAgentResult,
  CommandCenterExtensionResult,
  CommandCenterResultSection,
  CommandCenterWorkspaceResult,
} from "@/command-center/results";
import { PINNED_SECTION_BAND } from "@/command-center/results";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { useSearchScopeTranslation } from "@/i18n/search-scope";
import type { ProjectSummary } from "@/utils/projects";
import { findScopeCandidates, type SearchViewContext } from "./candidates";
import type { SearchScopeCatalog } from "./catalog";
import { searchScopeChips } from "./chip-store";
import { isScoped, resolveSearchScope, UNSCOPED, type SearchScopeChip } from "./model";
import { buildEmptyStateRows, buildScopeRows, type ScopeRowModel, type ScopeT } from "./rows";
import type { ScopeChipsProps } from "./scope-chips";
import { ScopeRowAction, ScopeRowContent } from "./scope-row";
import { useShowInWork } from "./show-in-work";
import { useSearchScopeCatalog } from "./use-scope-catalog";
import { useScopedItems } from "./use-scoped-items";
import { useSearchViewContext, viewContextChips } from "./view-context";
import type { ItemPlacement } from "./items";
import { isSearchScopeActive, SEARCH_SCOPE_ENABLED } from "./active";

export interface SearchScopeInput {
  open: boolean;
  /** The file scope owns the list; Host and Project scope step aside. */
  filesScope: boolean;
  query: string;
  isCompact: boolean;
  projects: readonly ProjectSummary[];
  agents: readonly AggregatedAgent[];
  workspaceRows: readonly CommandCenterWorkspaceResult[];
  agentRows: readonly CommandCenterAgentResult[];
  rankWorkspaces(
    rows: readonly CommandCenterWorkspaceResult[],
    query: string,
  ): CommandCenterWorkspaceResult[];
  rankAgents(rows: readonly CommandCenterAgentResult[], query: string): CommandCenterAgentResult[];
}

export interface SearchScope {
  /** Chips set: commands and files step aside, the list is the scope (README "Choices"). */
  scoped: boolean;
  chips: ScopeChipsProps | null;
  sections: CommandCenterResultSection[];
  workspaces: CommandCenterWorkspaceResult[];
  agents: CommandCenterAgentResult[];
  removeLastChip(): boolean;
}

function useFormatTime(language: string): (iso: string) => string {
  return useMemo(() => {
    const time = new Intl.DateTimeFormat(language, { hour: "2-digit", minute: "2-digit" });
    const dated = new Intl.DateTimeFormat(language, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    return (iso: string) => {
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) return "";
      const today = new Date().toDateString() === date.toDateString();
      return (today ? time : dated).format(date);
    };
  }, [language]);
}

/** Chips belong to one search; reopening within the restore window brings them back (R5). */
function useChipLifecycle(open: boolean): void {
  useLayoutEffect(() => {
    if (!open) return;
    searchScopeChips.opened(Date.now());
    return () => searchScopeChips.closed(Date.now());
  }, [open]);
}

function workspacePlacement(
  row: CommandCenterWorkspaceResult,
  catalog: SearchScopeCatalog,
): ItemPlacement {
  return {
    serverId: row.serverId,
    projectKey:
      catalog.projectKeyOfWorkspace(row.serverId, row.workspaceId) ??
      catalog.projectKeyByViewKey.get(row.project.viewKey) ??
      null,
  };
}

function agentPlacement(row: CommandCenterAgentResult, catalog: SearchScopeCatalog): ItemPlacement {
  const agent = row.agent;
  return {
    serverId: agent.serverId,
    projectKey: catalog.projectKeyOfAgent({
      serverId: agent.serverId,
      workspaceId: agent.workspaceId ?? null,
      cwd: agent.cwd,
      placementProjectName: agent.projectPlacement?.projectName ?? null,
    }),
  };
}

const workspaceAttention = (row: CommandCenterWorkspaceResult) => ({
  activityAt: row.activityAt,
  needsAction: false,
  running: false,
});

const agentAttention = (row: CommandCenterAgentResult) => ({
  activityAt: row.activityAt,
  needsAction: row.agent.requiresAttention === true || (row.agent.pendingPermissionCount ?? 0) > 0,
  running: row.agent.status === "running",
});

function toExtension(
  model: ScopeRowModel,
  input: { run(): void; secondary: (() => void) | null; touch: boolean; showInWorkLabel: string },
): CommandCenterExtensionResult {
  return {
    kind: "extension",
    id: model.id,
    lines: model.subtitle || model.note ? 2 : 1,
    accessibilityLabel: [model.title, model.subtitle, model.note].filter(Boolean).join(", "),
    testID: `${model.testID}-row`,
    keepOpen: true,
    acceptsTab: model.chips.length > 0,
    run: input.run,
    secondary: input.secondary,
    render: ({ query }) => <ScopeRowContent model={model} query={query} />,
    renderAction: model.workTarget
      ? ({ revealed, runSecondary }) => (
          <ScopeRowAction
            model={model}
            revealed={revealed}
            touch={input.touch}
            label={input.showInWorkLabel}
            runSecondary={runSecondary}
          />
        )
      : null,
  };
}

interface SectionInput {
  catalog: SearchScopeCatalog | null;
  query: string;
  chips: readonly SearchScopeChip[];
  view: SearchViewContext | null;
  t: ScopeT;
  formatTime(iso: string): string;
  touch: boolean;
  itemCount: number;
  showInWork: ReturnType<typeof useShowInWork>;
}

function candidateSections(input: SectionInput, scope: ReturnType<typeof resolveSearchScope>) {
  const { catalog, t } = input;
  if (!catalog) return { sections: [], inScopeCandidates: 0 };
  const candidates = findScopeCandidates({
    catalog,
    query: input.query,
    chips: input.chips,
    scope,
    view: input.view,
  });
  const context = {
    catalog,
    t,
    formatTime: input.formatTime,
    projectChipKeys: input.chips.flatMap((chip) => (chip.kind === "project" ? [chip.key] : [])),
  };
  const toResults = (models: ScopeRowModel[]) =>
    models.map((model) =>
      toExtension(model, {
        run: () => searchScopeChips.add(model.chips),
        secondary: model.workTarget ? () => input.showInWork(model) : null,
        touch: input.touch,
        showInWorkLabel: t("showInWorkLabel", { label: model.title }),
      }),
    );
  const sections: CommandCenterResultSection[] = [
    {
      id: "scope-projects",
      band: PINNED_SECTION_BAND,
      rank: 0,
      title: t("sections.projects"),
      results: toResults(buildScopeRows(candidates.projects, context)),
    },
    {
      id: "scope-hosts",
      band: PINNED_SECTION_BAND,
      rank: 1,
      title: t("sections.hosts"),
      results: toResults(buildScopeRows(candidates.hosts, context)),
    },
  ];
  const inScopeCandidates = [...candidates.projects, ...candidates.hosts].filter(
    (c) => !c.outOfScope,
  ).length;
  return { sections, inScopeCandidates };
}

function emptyStateSection(input: SectionInput): CommandCenterResultSection {
  const empty = buildEmptyStateRows(input.chips, input.query, input.t);
  const actions: Record<string, () => void> = {
    "scope:empty:remove-host": () => searchScopeChips.removeKind(["host", "hub"]),
    "scope:empty:remove-project": () => searchScopeChips.removeKind(["project"]),
    "scope:empty:everywhere": () => searchScopeChips.clear(),
  };
  return {
    id: "scope-empty",
    band: PINNED_SECTION_BAND,
    // After the Host and Project suggestions, so Enter still takes the one the user typed (R6),
    // and before the (empty) item sections.
    rank: 1.5,
    title: empty.title,
    results: empty.rows.map((model) =>
      toExtension(model, {
        run: actions[model.id]!,
        secondary: null,
        touch: input.touch,
        showInWorkLabel: "",
      }),
    ),
  };
}

function useScopeSections(input: SectionInput): CommandCenterResultSection[] {
  const { catalog, chips, query, view, t, formatTime, touch, itemCount, showInWork } = input;
  return useMemo(() => {
    const scope = catalog ? resolveSearchScope(chips, catalog.serverIdsByHub) : UNSCOPED;
    const values = { catalog, chips, query, view, t, formatTime, touch, itemCount, showInWork };
    const { sections, inScopeCandidates } = candidateSections(values, scope);
    if (chips.length > 0 && itemCount === 0 && inScopeCandidates === 0) {
      sections.push(emptyStateSection(values));
    }
    return sections;
  }, [catalog, chips, formatTime, itemCount, query, showInWork, t, touch, view]);
}

/** Global search's Host, Hub and Project scope (docs/features/global-search/README.md). */
export function useSearchScope(input: SearchScopeInput): SearchScope {
  const { t, i18n } = useSearchScopeTranslation();
  const formatTime = useFormatTime(i18n.language);
  const active = isSearchScopeActive({
    enabled: SEARCH_SCOPE_ENABLED,
    open: input.open,
    filesScope: input.filesScope,
  });
  useChipLifecycle(SEARCH_SCOPE_ENABLED && input.open);
  const chips = searchScopeChips.use();
  const liveChips = active ? chips : EMPTY_CHIPS;
  const catalog = useSearchScopeCatalog({
    enabled: active,
    projects: input.projects,
    agents: input.agents,
  });
  const view = useSearchViewContext(catalog);
  const scope = useMemo(
    () => (catalog ? resolveSearchScope(liveChips, catalog.serverIdsByHub) : UNSCOPED),
    [catalog, liveChips],
  );
  const shared = { query: input.query, catalog, view, scope, t: t as ScopeT, formatTime, active };
  const workspaces = useScopedItems({
    ...shared,
    rows: input.workspaceRows,
    itemKind: "workspace",
    placementOf: workspacePlacement,
    attentionOf: workspaceAttention,
    rank: input.rankWorkspaces,
  });
  const agents = useScopedItems({
    ...shared,
    rows: input.agentRows,
    itemKind: "session",
    placementOf: agentPlacement,
    attentionOf: agentAttention,
    rank: input.rankAgents,
  });
  const showInWork = useShowInWork(input.isCompact);
  const sections = useScopeSections({
    catalog,
    chips: liveChips,
    query: input.query,
    view,
    t: t as ScopeT,
    formatTime,
    touch: input.isCompact,
    itemCount: workspaces.length + agents.length,
    showInWork,
  });
  const chipsProps = useChipsProps(active, liveChips, catalog, view);
  return {
    scoped: isScoped(scope),
    chips: chipsProps,
    sections: active ? sections : NO_SECTIONS,
    workspaces,
    agents,
    removeLastChip: useCallback(() => active && searchScopeChips.removeLast(), [active]),
  };
}

const EMPTY_CHIPS: readonly SearchScopeChip[] = [];
const NO_SECTIONS: CommandCenterResultSection[] = [];

function useChipsProps(
  active: boolean,
  chips: readonly SearchScopeChip[],
  catalog: SearchScopeCatalog | null,
  view: SearchViewContext | null,
): ScopeChipsProps | null {
  return useMemo(() => {
    if (!active) return null;
    const suggestion =
      view && catalog
        ? { label: view.label, apply: () => searchScopeChips.add(viewContextChips(view, catalog)) }
        : null;
    return {
      chips,
      catalog,
      suggestion,
      remove: searchScopeChips.remove,
      clear: searchScopeChips.clear,
    };
  }, [active, catalog, chips, view]);
}
