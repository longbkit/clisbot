import { describe, expect, it } from "vitest";
import {
  getPanelManifest,
  panelCanLaunchInPane,
  panelCompactSheetPolicy,
  panelResourceKey,
  panelSupportsHost,
} from "@/panels/panel-manifest";

describe("panel manifest", () => {
  it("answers host support without React panel registration", () => {
    expect(panelSupportsHost("agent", "main")).toBe(true);
    expect(panelSupportsHost("agent", "explorer")).toBe(true);
    expect(panelSupportsHost("file", "explorer")).toBe(true);
    expect(panelSupportsHost("working_diff", "explorer")).toBe(true);
    expect(panelSupportsHost("new_tab", "explorer")).toBe(true);
    expect(panelSupportsHost("files", "explorer")).toBe(true);
    expect(panelSupportsHost("files", "main")).toBe(false);
    expect(panelSupportsHost("setup", "explorer")).toBe(false);
  });

  it("supports the sheet exactly for kinds with a compact sheet rule", () => {
    expect(panelSupportsHost("file", "sheet")).toBe(true);
    expect(panelSupportsHost("agent", "sheet")).toBe(true);
    expect(panelSupportsHost("provider_subagent", "sheet")).toBe(true);
    expect(panelSupportsHost("terminal", "sheet")).toBe(false);
    expect(panelSupportsHost("plugin", "sheet")).toBe(false);
  });

  it("keeps conversation and root agent tabs while profiles can open in a compact sheet", () => {
    const facts = { isWorkspaceRootAgent: (agentId: string) => agentId === "root" };
    expect(panelCompactSheetPolicy({ kind: "conversation", chatId: "group" }, facts)).toBeNull();
    expect(panelCompactSheetPolicy({ kind: "agent", agentId: "root" }, facts)).toBeNull();
    expect(panelCompactSheetPolicy({ kind: "agent", agentId: "child" }, facts)).toEqual({
      openAsTab: true,
    });
    expect(
      panelCompactSheetPolicy(
        { kind: "user_profile", actor: { kind: "user", id: "person" } },
        facts,
      ),
    ).toEqual({ openAsTab: true });
    expect(panelSupportsHost("conversation", "sheet")).toBe(false);
    expect(panelSupportsHost("user_profile", "sheet")).toBe(true);
  });

  it("lets navigation tabs hide their close button without losing their close action", () => {
    expect(getPanelManifest("files").showCloseButton).toBe(false);
    expect(getPanelManifest("changes_tree").showCloseButton).toBe(false);
    expect(getPanelManifest("agent").showCloseButton).toBe(true);
    expect(getPanelManifest("terminal").showCloseButton).toBe(true);
    expect(getPanelManifest("file").showCloseButton).toBe(true);
    expect(getPanelManifest("working_diff").showCloseButton).toBe(true);
  });

  it("hides a singleton launch only when it already exists in the destination pane", () => {
    expect(panelCanLaunchInPane("files", ["files"])).toBe(false);
    expect(panelCanLaunchInPane("changes_tree", ["changes_tree"])).toBe(false);
    expect(panelCanLaunchInPane("files", ["changes_tree"])).toBe(true);
    expect(panelCanLaunchInPane("files", [])).toBe(true);
    expect(panelCanLaunchInPane("terminal", ["terminal"])).toBe(true);
  });

  it("keeps durable resource identity separate from transient target input", () => {
    expect(
      panelResourceKey({ kind: "working_diff", focusPath: "src/a.ts", focusRequestId: 1 }),
    ).toBe(panelResourceKey({ kind: "working_diff", focusPath: "src/b.ts", focusRequestId: 2 }));
    expect(panelResourceKey({ kind: "file", path: "src/a.ts" })).not.toBe(
      panelResourceKey({ kind: "file", path: "src/b.ts" }),
    );
  });
});
