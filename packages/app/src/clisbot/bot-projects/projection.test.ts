import { mergeWithRemainder } from "@/utils/sidebar-reorder";
import { splitPinnedSidebarGroups } from "@/hooks/use-sidebar-pins";
import { buildSidebarWorkspacePlacementModel } from "@/hooks/sidebar-workspaces-view-model";
import { describe, expect, it } from "vitest";
import type { WorkspaceStructureProject } from "@/projects/workspace-structure";
import { projectBotWorkspaces, isBotProject, splitBotStatusGroups } from "./projection";
import type { SidebarWorkspaceGroup } from "@/components/sidebar/sidebar-labels";

const mixed: WorkspaceStructureProject = {
  viewKey: "shared",
  projectKey: "shared",
  projectName: "Shared",
  projectKind: "directory",
  iconWorkingDir: "/a",
  hosts: [
    { serverId: "a", projectId: "p", iconWorkingDir: "/a", worktreeSupport: "unsupported" },
    { serverId: "b", projectId: "p", iconWorkingDir: "/b", worktreeSupport: "unsupported" },
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
  it("splits mixed projects with distinct stable keys and disjoint workspace identities", () => {
    const projects = projectBotWorkspaces([mixed], keys, true);
    expect(new Set(projects.map((p) => p.viewKey)).size).toBe(2);
    expect(projects.flatMap((p) => p.workspaceKeys)).toEqual(["b:wb", "a:wa"]);
    expect(projects.map((p) => isBotProject(p))).toEqual([false, true]);
    expect(projects.map((p) => p.projectName)).toEqual(["Shared", "Shared"]);
  });
  it("keeps real view keys distinct from allocated Bot partition keys", () => {
    const regular = {
      ...mixed,
      viewKey: "bot-project:shared",
      hosts: [mixed.hosts[1]],
      workspaceKeys: ["b:other"],
    };
    const projected = projectBotWorkspaces([mixed, regular], keys, true);
    expect(new Set(projected.map((p) => p.viewKey)).size).toBe(3);
    expect(isBotProject(projected[2])).toBe(false);
  });
  it("uses the longest Host prefix to avoid duplicate placements", () => {
    const source = {
      ...mixed,
      hosts: [mixed.hosts[0], { ...mixed.hosts[1], serverId: "a:b" }],
      workspaceKeys: ["a:wa", "a:b:wb"],
    };
    const projected = projectBotWorkspaces([source], keys, true);
    expect(projected.map((p) => p.workspaceKeys)).toEqual([["a:b:wb"], ["a:wa"]]);
  });
  it("hides bot-only workspaces before any downstream pinned extraction", () => {
    expect(projectBotWorkspaces([mixed], new Set(["a:p", "b:p"]), false)).toEqual([]);
  });
  it("partitions existing status rows, retaining bucket labels and distinct collapse keys", () => {
    const projects = projectBotWorkspaces([mixed], keys, true);
    const rows = projects.map((p) => ({
      projectViewKey: p.viewKey,
      botProject: p.botProject,
      workspaceKey: p.workspaceKeys[0],
    }));
    const groups = [
      { key: "running", label: "Running", rows, leading: { kind: "status", bucket: "running" } },
    ] as SidebarWorkspaceGroup[];
    const split = splitBotStatusGroups(groups);
    expect(split.regular[0].key).toBe("running");
    expect(split.bots[0].key).not.toBe(split.regular[0].key);
    expect(split.bots[0].label).toBe("Running");
    expect([...split.regular, ...split.bots].flatMap((g) => g.rows)).toEqual(rows);
  });
});

it("extracts visible pins once and never resurrects hidden Bot pins", () => {
  const split = (show: boolean) =>
    splitPinnedSidebarGroups({
      projects: buildSidebarWorkspacePlacementModel({
        projects: projectBotWorkspaces([mixed], keys, show),
      }).projects,
      keys: { pinnedWorkspaceKeys: ["a:wa"], pinnedAtByKey: { "a:wa": "2026-09-26" } },
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
