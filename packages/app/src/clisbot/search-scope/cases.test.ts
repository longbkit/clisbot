import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";
import { usePanelStore } from "@/stores/panel-store";
import { buildSearchScopeCatalog, type ScopeHostInput, type ScopeProjectInput } from "./catalog";
import { findScopeCandidates, type ScopeCandidate, type SearchViewContext } from "./candidates";
import { CHIP_RESTORE_WINDOW_MS, searchScopeChips } from "./chip-store";
import { annotateItem } from "./item-notes";
import {
  compareByAttention,
  filterItemsToScope,
  rankItemsByView,
  type ItemPlacement,
} from "./items";
import { foldSearchText, resolveSearchScope, type SearchScopeChip } from "./model";
import { buildEmptyStateRows, buildScopeRows, type RowContext, type ScopeT } from "./rows";
import { isSearchScopeActive } from "./active";
import {
  getOutsideFilterReveal,
  openInWork,
  setOpenInWorkHandler,
  setOutsideFilterReveal,
} from "./work-navigation";

/** Keys in, keys plus their options out: the copy itself is tested in `i18n/search-scope`. */
const t: ScopeT = (key, options) => (options ? `${key}${JSON.stringify(options)}` : key);
const formatTime = (iso: string) => iso.slice(11, 16);

function host(
  serverId: string,
  label: string,
  extra: Partial<ScopeHostInput> = {},
): ScopeHostInput {
  return {
    serverId,
    label,
    local: false,
    hubOrigin: null,
    hubName: null,
    hostnames: [],
    status: "online",
    lastOnlineAt: null,
    ...extra,
  };
}

function project(serverId: string, name: string, workspaceIds: string[] = []): ScopeProjectInput {
  return {
    viewKey: `view:${name}`,
    serverId,
    projectName: name,
    customName: null,
    repoRoot: `/repos/${name}`,
    workspaceIds,
  };
}

const HUB = "hub://company";
const hub = { hubOrigin: HUB, hubName: "Company" };

/** Local + three Company sandboxes; clisbot on all four, anyapp only on local. */
function fleet() {
  return buildSearchScopeCatalog({
    hosts: [
      host("local", "Máy của Long", { local: true }),
      host("sb12", "sandbox-12", { ...hub, hostnames: ["10.0.0.12"] }),
      host("sb13", "sandbox-13", hub),
      host("sb14", "sandbox-14", {
        ...hub,
        status: "offline",
        lastOnlineAt: "2026-10-25T10:42:00.000Z",
      }),
    ],
    projects: [
      project("local", "clisbot", ["w-local"]),
      project("local", "anyapp"),
      project("sb12", "clisbot", ["w-12"]),
      project("sb13", "clisbot"),
      project("sb14", "clisbot", ["w-14"]),
    ],
    agents: [
      {
        serverId: "local",
        workspaceId: "w-local",
        cwd: "/repos/clisbot",
        placementProjectName: null,
      },
      {
        serverId: "sb12",
        workspaceId: null,
        cwd: "/repos/clisbot/packages/app",
        placementProjectName: null,
      },
      { serverId: "sb14", workspaceId: "w-14", cwd: "/x", placementProjectName: null },
    ],
  });
}

type Catalog = ReturnType<typeof fleet>;

function candidates(
  catalog: Catalog,
  query: string,
  chips: SearchScopeChip[] = [],
  view: SearchViewContext | null = null,
) {
  const scope = resolveSearchScope(chips, catalog.serverIdsByHub);
  return findScopeCandidates({ catalog, query, chips, scope, view });
}

function rows(catalog: Catalog, list: ScopeCandidate[], chips: SearchScopeChip[] = []) {
  const context: RowContext = {
    catalog,
    t,
    formatTime,
    projectChipKeys: chips.flatMap((chip) => (chip.kind === "project" ? [chip.key] : [])),
  };
  return buildScopeRows(list, context);
}

const hostChip = (serverId: string, label: string): SearchScopeChip => ({
  kind: "host",
  serverId,
  label,
});
const projectChip = (key: string): SearchScopeChip => ({ kind: "project", key, label: key });

/** Items as the command center lists them: one session per (Host, project). */
const place = (
  serverId: string,
  projectKey: string | null,
  extra: Partial<ItemPlacement> = {},
): ItemPlacement => ({ serverId, projectKey, workspaceId: null, ownership: "mine", ...extra });

const ITEMS: (ItemPlacement & { id: string })[] = [
  { id: "release on local", ...place("local", "clisbot", { workspaceId: "w-local" }) },
  { id: "release on sb12", ...place("sb12", "clisbot", { workspaceId: "w-12" }) },
  { id: "anyapp on local", ...place("local", "anyapp") },
  { id: "release on sb14", ...place("sb14", "clisbot", { workspaceId: "w-14" }) },
];

const view = (input: Partial<SearchViewContext>): SearchViewContext => ({
  label: "",
  serverIds: null,
  projectKeys: null,
  ownership: null,
  suggest: true,
  ...input,
});

function itemsIn(catalog: Catalog, chips: SearchScopeChip[]) {
  const scope = resolveSearchScope(chips, catalog.serverIdsByHub);
  return filterItemsToScope(ITEMS, scope, (item) => item).map((item) => item.id);
}

beforeEach(() => searchScopeChips.clear());

describe("global search case table (docs/features/global-search/README.md)", () => {
  it("1: a Host name finds the Host; Enter adds its chip and narrows items to it", () => {
    const catalog = fleet();
    const found = candidates(catalog, "sandbox-12");
    const [row] = rows(catalog, found.hosts);
    expect(row).toMatchObject({
      title: "sandbox-12",
      status: "online",
      chips: [hostChip("sb12", "sandbox-12")],
    });
    expect(row!.subtitle).toBe("Company · 10.0.0.12");
    searchScopeChips.add(row!.chips);
    expect(itemsIn(catalog, [...searchScopeChips.get()])).toEqual(["release on sb12"]);
    // An address finds it too.
    expect(rows(catalog, candidates(catalog, "10.0.0").hosts)[0]?.title).toBe("sandbox-12");
  });

  it("2: a project on several Hosts is one row, and its chip spans every Host", () => {
    const catalog = fleet();
    const [merged] = rows(catalog, candidates(catalog, "clisbot").projects);
    expect(merged).toMatchObject({ title: "clisbot", chips: [projectChip("clisbot")] });
    expect(merged!.subtitle).toBe('project.onHosts{"count":4}');
    expect(itemsIn(catalog, merged!.chips)).toEqual([
      "release on local",
      "release on sb12",
      "release on sb14",
    ]);
  });

  it("3: naming a Host in a project query offers that placement, which adds two chips", () => {
    const catalog = fleet();
    const projects = rows(catalog, candidates(catalog, "clisbot sandbox-12").projects);
    expect(projects.map((row) => row.id)).toEqual([
      "scope:project:clisbot",
      "scope:project:clisbot:sb12",
    ]);
    expect(projects[1]!.chips).toEqual([hostChip("sb12", "sandbox-12"), projectChip("clisbot")]);
    expect(itemsIn(catalog, projects[1]!.chips)).toEqual(["release on sb12"]);
  });

  it("4: Hosts with the same name are told apart by source, then by a short id", () => {
    const catalog = buildSearchScopeCatalog({
      hosts: [
        host("srv_aaaaaaaa", "build", hub),
        host("srv_bbbbbbbb", "build"),
        host("srv_cccccccc", "build", hub),
      ],
      projects: [],
      agents: [],
    });
    const found = rows(catalog, candidates(catalog, "build").hosts);
    expect(found.map((row) => row.subtitle).sort()).toEqual([
      "Company · aaaaaa",
      "Company · cccccc",
      "host.direct",
    ]);
    expect(new Set(found.map((row) => row.chips[0]!.label)).size).toBe(3);
  });

  it("5: a Host chip plus a project that is not on it gives the way-out empty state", () => {
    const catalog = fleet();
    const chips = [hostChip("sb12", "sandbox-12")];
    expect(itemsIn(catalog, chips).filter((id) => id.startsWith("anyapp"))).toEqual([]);
    const found = candidates(catalog, "anyapp", chips);
    expect(found.projects).toMatchObject([{ kind: "project", outOfScope: true }]);
    expect(rows(catalog, found.projects, chips)[0]!.note).toContain("project.notInScope");
    const empty = buildEmptyStateRows(chips, "anyapp", t);
    expect(empty.title).toBe('empty.noMatchesIn{"query":"anyapp","scope":"sandbox-12"}');
    expect(empty.rows.map((row) => row.title)).toEqual(["empty.removeHostFilter"]);
    const both = buildEmptyStateRows([...chips, projectChip("clisbot")], "x", t);
    expect(both.rows.map((row) => row.title)).toEqual([
      "empty.removeHostFilter",
      "empty.removeProjectFilter",
      "empty.searchEverywhere",
    ]);
    searchScopeChips.add([...chips, projectChip("clisbot")]);
    searchScopeChips.removeKind(["host", "hub"]);
    expect(searchScopeChips.get()).toEqual([projectChip("clisbot")]);
  });

  it("6: a Project chip keeps the query searching inside it on every Host", () => {
    const catalog = fleet();
    expect(itemsIn(catalog, [projectChip("clisbot")])).toEqual([
      "release on local",
      "release on sb12",
      "release on sb14",
    ]);
  });

  it("7: a Hub chip covers its Hosts; empty query lists needs-action, running, then recent", () => {
    const catalog = fleet();
    const [hubRow] = rows(catalog, candidates(catalog, "company").hosts);
    expect(hubRow).toMatchObject({
      icon: "hub",
      chips: [{ kind: "hub", origin: HUB, label: "Company" }],
    });
    expect(itemsIn(catalog, hubRow!.chips)).toEqual(["release on sb12", "release on sb14"]);
    const at = (minutes: number) => new Date(Date.UTC(2026, 9, 25, 10, minutes));
    const sorted = [
      { id: "old", activityAt: at(1), needsAction: false, running: false },
      { id: "running", activityAt: at(2), needsAction: false, running: true },
      { id: "new", activityAt: at(9), needsAction: false, running: false },
      { id: "asks", activityAt: at(0), needsAction: true, running: false },
    ].sort(compareByAttention);
    expect(sorted.map((row) => row.id)).toEqual(["asks", "running", "new", "old"]);
  });

  it("8: a Host chip with an empty query suggests that Host's projects", () => {
    const catalog = fleet();
    const found = candidates(catalog, "", [hostChip("local", "Máy của Long")]);
    expect(found.projects.map((c) => (c.kind === "project" ? c.project.key : ""))).toEqual([
      "clisbot",
      "anyapp",
    ]);
    expect(found.hosts).toEqual([]);
  });

  it("9: with a Project chip, Hosts lacking it are labelled, not hidden", () => {
    const catalog = buildSearchScopeCatalog({
      hosts: [host("a", "sand-a"), host("b", "sand-b")],
      projects: [project("a", "clisbot")],
      agents: [],
    });
    const chips = [projectChip("clisbot")];
    const found = rows(catalog, candidates(catalog, "sand", chips).hosts, chips);
    expect(found.map((row) => [row.title, row.note?.includes("host.noProject")])).toEqual([
      ["sand-a", false],
      ["sand-b", true],
    ]);
  });

  it("10: two Host chips combine with OR", () => {
    const catalog = fleet();
    searchScopeChips.add([hostChip("sb12", "sandbox-12")]);
    searchScopeChips.add([hostChip("sb14", "sandbox-14")]);
    expect(itemsIn(catalog, [...searchScopeChips.get()])).toEqual([
      "release on sb12",
      "release on sb14",
    ]);
    // A chip already set is not offered again.
    expect(
      candidates(catalog, "sandbox", [...searchScopeChips.get()]).hosts.map(
        (c) => c.kind === "host" && c.host.serverId,
      ),
    ).toEqual(["sb13"]);
  });

  it("11: offline Hosts stay searchable and say how old their data is", () => {
    const catalog = fleet();
    const [row] = rows(catalog, candidates(catalog, "sandbox-14").hosts);
    expect(row).toMatchObject({ status: "offline" });
    expect(row!.note).toContain('host.lastOnline{"time":"10:42"}');
    const note = annotateItem({
      itemKind: "session",
      placement: place("sb14", "clisbot"),
      catalog,
      view: null,
      t,
      formatTime,
    });
    expect(note).toEqual({ note: 'note.offlineCached{"time":"10:42"}', reveal: null });
    // Online rows rank before the offline one when the match is equal.
    const hosts = candidates(catalog, "sandbox").hosts.map(
      (c) => c.kind === "host" && c.host.serverId,
    );
    expect(hosts.indexOf("sb14")).toBe(hosts.length - 1);
  });

  it("12: a view filter ranks inside-first and labels the rest, hiding nothing", () => {
    const catalog = fleet();
    const filter = view({ label: "sandbox-12", serverIds: new Set(["sb12"]) });
    const ranked = rankItemsByView(ITEMS, filter, (item) => item);
    expect(ranked.map((item) => item.id)).toEqual([
      "release on sb12",
      "release on local",
      "anyapp on local",
      "release on sb14",
    ]);
    const outside = annotateItem({
      itemKind: "session",
      placement: ITEMS[0]!,
      catalog,
      view: filter,
      t,
      formatTime,
    });
    expect(outside.note).toBe("note.outsideFilter");
  });

  it("13: opening an item outside the filter publishes the reveal, and leaves the filter", () => {
    const catalog = fleet();
    const filter = view({ label: "Máy của Long", serverIds: new Set(["local"]) });
    const { reveal } = annotateItem({
      itemKind: "session",
      placement: place("sb12", "clisbot", { workspaceId: "w-12" }),
      catalog,
      view: filter,
      t,
      formatTime,
    });
    expect(reveal).toEqual({
      itemKind: "session",
      serverId: "sb12",
      hostLabel: "sandbox-12",
      projectName: "clisbot",
      projectViewKeys: ["view:clisbot"],
      reason: "host",
      target: { kind: "workspace", serverId: "sb12", id: "w-12" },
    });
    setOutsideFilterReveal(reveal);
    expect(getOutsideFilterReveal()).toEqual(reveal);
    setOutsideFilterReveal(null);
  });

  it("14: Show in Work replaces the conflicting dimension and Undo restores it", () => {
    useSidebarViewStore.setState({ hostFilters: ["local"], projectFilters: ["view:other"] });
    const open = vi.spyOn(usePanelStore.getState(), "openAgentListForLayout");
    const catalog = fleet();
    const placement = rows(catalog, candidates(catalog, "clisbot sandbox-12").projects)[1]!;
    const undo = openInWork(placement.workTarget!, { isCompact: false });
    expect(useSidebarViewStore.getState()).toMatchObject({
      hostFilters: ["sb12"],
      projectFilters: ["view:clisbot"],
    });
    undo();
    expect(useSidebarViewStore.getState()).toMatchObject({
      hostFilters: ["local"],
      projectFilters: ["view:other"],
    });
    // A Host-only target keeps the project filter the user set.
    openInWork(
      { serverIds: ["sb13"], projectNames: [], projectViewKeys: [] },
      { isCompact: false },
    )();
    open.mockRestore();
    // Navigation V2 installs its own handler.
    const handler = vi.fn(() => () => {});
    const restore = setOpenInWorkHandler(handler);
    openInWork(placement.workTarget!, { isCompact: true });
    expect(handler).toHaveBeenCalledWith(placement.workTarget, { isCompact: true });
    restore();
  });

  it("15–16: Backspace removes the last chip; clear removes all", () => {
    searchScopeChips.add([hostChip("a", "A"), projectChip("clisbot")]);
    expect(searchScopeChips.removeLast()).toBe(true);
    expect(searchScopeChips.get()).toEqual([hostChip("a", "A")]);
    searchScopeChips.add([projectChip("x")]);
    searchScopeChips.clear();
    expect(searchScopeChips.removeLast()).toBe(false);
  });

  describe("17: chips reset on close unless reopened within the window", () => {
    afterEach(() => vi.useRealTimers());
    it("restores within the window and drops after it", () => {
      searchScopeChips.add([hostChip("a", "A")]);
      searchScopeChips.closed(1_000);
      searchScopeChips.opened(1_000 + 3_000);
      expect(searchScopeChips.get()).toHaveLength(1);
      searchScopeChips.closed(10_000);
      searchScopeChips.opened(10_000 + CHIP_RESTORE_WINDOW_MS + 1);
      expect(searchScopeChips.get()).toEqual([]);
    });
  });

  it("18: the file scope turns Host and Project scope off; the flag turns it all off", () => {
    expect(isSearchScopeActive({ enabled: true, open: true, filesScope: true })).toBe(false);
    expect(isSearchScopeActive({ enabled: false, open: true, filesScope: false })).toBe(false);
    expect(isSearchScopeActive({ enabled: true, open: true, filesScope: false })).toBe(true);
  });
});

describe("matching", () => {
  it("ignores case and Vietnamese diacritics", () => {
    const catalog = fleet();
    expect(rows(catalog, candidates(catalog, "may cua").hosts)[0]?.title).toBe("Máy của Long");
    expect(foldSearchText("Đường Máy")).toBe("duong may");
    expect(foldSearchText("Đường Máy")).toHaveLength("Đường Máy".length);
  });

  it("attributes sessions to projects by workspace, then by repo folder", () => {
    const catalog = fleet();
    expect(catalog.projectByKey.get("clisbot")?.sessionCount).toBe(3);
    expect(catalog.hostById.get("sb12")?.sessionCount).toBe(1);
  });

  it("never lists a project from a Host the user cannot see", () => {
    const catalog = buildSearchScopeCatalog({
      hosts: [host("a", "A")],
      projects: [project("a", "mine"), project("revoked", "secret")],
      agents: [],
    });
    expect(candidates(catalog, "secret").projects).toEqual([]);
  });
});
