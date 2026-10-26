import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/sidebar/sidebar-status-list", () => ({}));
vi.mock("@/components/sidebar/empty-states", () => ({}));
vi.mock("@/components/ui/scroll-view", () => ({}));
vi.mock("@/clisbot/workspace-sessions/model", () => ({}));
vi.mock("@/clisbot/workspace-sessions/project-above", () => ({}));
vi.mock("@/stores/sidebar-collapsed-sections-store", () => ({}));
vi.mock("react-native-unistyles", () => ({ StyleSheet: { create: () => ({}) } }));

const { flattenStatusGroups } = await import("./sidebar-status-flat-list");

type Group = Parameters<typeof flattenStatusGroups>[0][number];

function group(key: string, kind: "none" | "status" | "project", count: number): Group {
  const items = Array.from({ length: count }, (_, i) => ({
    kind: "workspace" as const,
    key: `${key}:${i}`,
    workspace: { workspaceKey: `${key}:${i}` },
  }));
  return { key, label: key, leading: { kind } as never, rows: [], items } as unknown as Group;
}

describe("Navigation V2's flat Workspace list", () => {
  it("lists every row of a headerless grouping, with no Show more fold", () => {
    const items = flattenStatusGroups([group("session", "none", 250)], new Set(), true);
    expect(items).toHaveLength(250);
    expect(items.every((item) => item.type === "row")).toBe(true);
  });

  it("keeps a collapsed group's header and drops its rows", () => {
    const items = flattenStatusGroups(
      [group("running", "status", 3), group("done", "status", 4)],
      new Set(["done"]),
      true,
    );
    expect(items.map((item) => item.key)).toEqual([
      "header:running",
      "running:0",
      "running:1",
      "running:2",
      "header:done",
    ]);
  });
});
