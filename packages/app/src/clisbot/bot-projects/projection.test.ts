import { mergeWithRemainder } from "@/utils/sidebar-reorder";
import { splitPinnedSidebarGroups } from "@/hooks/use-sidebar-pins";
import { buildSidebarWorkspacePlacementModel } from "@/hooks/sidebar-workspaces-view-model";
import { describe, expect, it } from "vitest";
import type { WorkspaceStructureProject } from "@/projects/workspace-structure";
import { projectBotWorkspaces } from "./projection";

const mixed: WorkspaceStructureProject = {
  viewKey: "shared",
  projectKey: "shared",
  projectName: "Shared",
  projectKind: "directory",
  iconWorkingDir: "/a",
  hosts: [
    {
      serverId: "a",
      projectId: "p",
      iconWorkingDir: "/a",
      worktreeSupport: "unsupported",
    },
    {
      serverId: "b",
      projectId: "p",
      iconWorkingDir: "/b",
      worktreeSupport: "unsupported",
    },
  ],
  workspaceKeys: ["a:wa", "b:wb"],
};
const keys = new Set(["a:p"]);
describe("Bot project visibility projection", () => {
  it("keeps feature-off input identity", () => {
    const projects = [mixed];
    expect(projectBotWorkspaces(projects, new Set(), true)).toBe(projects);
  });
  it("hides bot Host placement without hiding a regular replica with the same project ID", () => {
    const [regular] = projectBotWorkspaces([mixed], keys, false);
    expect(regular).toMatchObject({
      viewKey: "shared",
      projectName: "Shared",
      iconWorkingDir: "/b",
      workspaceKeys: ["b:wb"],
    });
    expect(regular.hosts.map((h) => h.serverId)).toEqual(["b"]);
    expect(mixed.workspaceKeys).toEqual(["a:wa", "b:wb"]);
  });
  it("keeps visible Bot and regular Host placements together in one project", () => {
    const projects = [mixed];
    expect(projectBotWorkspaces(projects, keys, true)).toBe(projects);
    expect(projects[0].workspaceKeys).toEqual(["a:wa", "b:wb"]);
  });
  it("keeps unrelated projects unchanged when hiding Bot placements", () => {
    const regular = {
      ...mixed,
      viewKey: "bot-project:shared",
      hosts: [mixed.hosts[1]],
      workspaceKeys: ["b:other"],
    };
    const projected = projectBotWorkspaces([mixed, regular], keys, false);
    expect(projected.map((project) => project.viewKey)).toEqual(["shared", "bot-project:shared"]);
    expect(projected[1]).toBe(regular);
  });
  it("uses the longest Host prefix to avoid duplicate placements", () => {
    const source = {
      ...mixed,
      hosts: [mixed.hosts[0], { ...mixed.hosts[1], serverId: "a:b" }],
      workspaceKeys: ["a:wa", "a:b:wb"],
    };
    const projected = projectBotWorkspaces([source], keys, false);
    expect(projected.map((p) => p.workspaceKeys)).toEqual([["a:b:wb"]]);
  });
  it("hides bot-only workspaces before any downstream pinned extraction", () => {
    expect(projectBotWorkspaces([mixed], new Set(["a:p", "b:p"]), false)).toEqual([]);
  });
});

it("extracts visible pins once and never resurrects hidden Bot pins", () => {
  const split = (show: boolean) =>
    splitPinnedSidebarGroups({
      projects: buildSidebarWorkspacePlacementModel({
        projects: projectBotWorkspaces([mixed], keys, show),
      }).projects,
      keys: {
        pinnedWorkspaceKeys: ["a:wa"],
        pinnedAtByKey: { "a:wa": "2026-09-26" },
      },
      pinnedWorkspaceOrder: [],
    });
  expect(split(false).pinnedChats).toEqual([]);
  expect(split(true).pinnedChats.map((w) => w.workspaceKey)).toEqual(["a:wa"]);
  expect(
    split(true)
      .unpinnedProjects.flatMap((p) => p.workspaces)
      .map((w) => w.workspaceKey),
  ).toEqual(["b:wb"]);
});
it("reordering a project slice preserves the sibling slice ordering", () => {
  const order = ["regular-a", "regular-b", "bot-a", "bot-b"];
  const next = mergeWithRemainder({
    currentOrder: order,
    reorderedVisibleKeys: ["bot-b", "bot-a"],
  });
  expect(next.filter((key) => key.startsWith("regular"))).toEqual(["regular-a", "regular-b"]);
  expect(new Set(next)).toEqual(new Set(order));
});
