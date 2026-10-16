import { describe, expect, test } from "vitest";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import {
  filterWorkspacesByProjects,
  resolveActiveProjectFilters,
  shouldAwaitSidebarEntryProjection,
} from "./sidebar-project-filter";

function workspace(workspaceId: string, projectViewKey: string): SidebarWorkspaceEntry {
  return {
    workspaceKey: `host:${workspaceId}`,
    serverId: "host",
    workspaceId,
    projectViewKey,
    projectName: projectViewKey,
    projectRootPath: `/repo/${projectViewKey}`,
    workspaceDirectory: `/repo/${projectViewKey}/${workspaceId}`,
    workspaceDirectoryLabel: workspaceId,
    projectKind: "git",
    workspaceKind: "worktree",
    name: workspaceId,
    title: null,
    pinnedAt: null,
    labels: [],
    currentBranch: "main",
    statusBucket: "done",
    statusEnteredAt: null,
    archivingAt: null,
    diffStat: null,
    prHint: null,
    archiveHasUncommittedChanges: null,
    archiveUnpushedCommitCount: null,
    scripts: [],
    hasRunningScripts: false,
  };
}

describe("resolveActiveProjectFilters", () => {
  test("reads an empty stored filter as every project", () => {
    expect(resolveActiveProjectFilters([], new Set(["alpha", "beta"]))).toEqual([]);
  });

  test("keeps only the keys that still name a project it can see", () => {
    expect(resolveActiveProjectFilters(["alpha", "gone"], new Set(["alpha", "beta"]))).toEqual([
      "alpha",
    ]);
    expect(resolveActiveProjectFilters(["alpha", "beta"], new Set(["alpha", "beta"]))).toEqual([
      "alpha",
      "beta",
    ]);
  });

  // Nothing deletes the stored keys, so a filter naming only projects on a host that has not
  // connected yet must go inert rather than blank the sidebar. It comes back with the host.
  test("goes inert instead of matching nothing", () => {
    expect(resolveActiveProjectFilters(["alpha"], new Set(["beta"]))).toEqual([]);
    expect(resolveActiveProjectFilters(["alpha"], new Set())).toEqual([]);
  });
});

describe("filterWorkspacesByProjects", () => {
  const workspaces = [
    workspace("one", "alpha"),
    workspace("two", "alpha"),
    workspace("three", "beta"),
  ];

  function filtered(projectFilters: string[]) {
    return filterWorkspacesByProjects({ workspaces, projectFilters }).map(
      (entry) => entry.workspaceId,
    );
  }

  test("keeps every workspace when nothing is pinned", () => {
    expect(filtered([])).toEqual(["one", "two", "three"]);
  });

  test("keeps the workspaces of the pinned projects", () => {
    expect(filtered(["alpha"])).toEqual(["one", "two"]);
    expect(filtered(["beta"])).toEqual(["three"]);
    expect(filtered(["alpha", "beta"])).toEqual(["one", "two", "three"]);
  });

  test("keeps nothing for a project with no workspaces", () => {
    expect(filtered(["gamma"])).toEqual([]);
  });
});

describe("first retained entry projection", () => {
  test("does not mistake unhydrated entries for a filtered-empty catalog", () => {
    const placements = [{ workspaceKey: "host-a:one" }, { workspaceKey: "host-b:two" }];
    const pending = {
      entriesEnabled: false,
      directoryInitialLoading: false,
      placements,
      entries: new Map<string, unknown>(),
      hasVisibleProjects: false,
    };
    expect(shouldAwaitSidebarEntryProjection(pending)).toBe(true);
    // Project refs can arrive before the first workspace directory, even while active.
    expect(
      shouldAwaitSidebarEntryProjection({
        ...pending,
        entriesEnabled: true,
        directoryInitialLoading: true,
      }),
    ).toBe(true);
    expect(
      shouldAwaitSidebarEntryProjection({
        ...pending,
        placements: [],
        directoryInitialLoading: true,
      }),
    ).toBe(true);
    // An unrelated retained Host cannot establish the selected scope's empty result.
    expect(
      shouldAwaitSidebarEntryProjection({
        ...pending,
        placements: [placements[1]],
        entries: new Map([["host-a:one", {}]]),
      }),
    ).toBe(true);
    // Once enabled, the real projection owns removals and empty results.
    expect(shouldAwaitSidebarEntryProjection({ ...pending, entriesEnabled: true })).toBe(false);
    expect(shouldAwaitSidebarEntryProjection({ ...pending, placements: [] })).toBe(false);
    // Preserve visible partial content and accepted filter-empty actions during refresh.
    expect(shouldAwaitSidebarEntryProjection({ ...pending, hasVisibleProjects: true })).toBe(false);
    expect(
      shouldAwaitSidebarEntryProjection({
        ...pending,
        entries: new Map(placements.map(({ workspaceKey }) => [workspaceKey, {}])),
      }),
    ).toBe(false);
  });
});
