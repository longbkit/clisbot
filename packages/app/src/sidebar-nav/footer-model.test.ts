import { describe, expect, it } from "vitest";
import {
  moveSidebarFooterItem,
  resolveSidebarFooterItems,
  setSidebarFooterItemVisible,
} from "./footer-model";

describe("sidebar bottom preferences", () => {
  it("replaces Add project with New and Search by default", () => {
    expect(
      resolveSidebarFooterItems([])
        .filter((item) => item.visible)
        .map((item) => item.key),
    ).toEqual(["new", "search", "hosts", "help", "settings"]);
  });

  it("restores toggles and order while keeping actions on the left and controls on the right", () => {
    let preferences = setSidebarFooterItemVisible([], "add-project", true);
    preferences = setSidebarFooterItemVisible(preferences, "import-session", true);
    preferences = setSidebarFooterItemVisible(preferences, "new", false);
    preferences = moveSidebarFooterItem(preferences, "import-session", "up");
    preferences = moveSidebarFooterItem(preferences, "search", "up");
    expect(resolveSidebarFooterItems(JSON.parse(JSON.stringify(preferences)))).toEqual([
      { key: "new", group: "actions", visible: false, labelKey: "sidebar.actions.new" },
      { key: "search", group: "actions", visible: true, labelKey: "sidebar.sections.search" },
      {
        key: "add-project",
        group: "actions",
        visible: true,
        labelKey: "sidebar.actions.addProject",
      },
      { key: "import-session", group: "controls", visible: true, labelKey: "importSession.title" },
      { key: "hosts", group: "controls", visible: true, labelKey: "sidebar.actions.hosts" },
      { key: "help", group: "fixed", visible: true, labelKey: "sidebar.help.trigger" },
      { key: "settings", group: "fixed", visible: true, labelKey: "sidebar.actions.settings" },
    ]);
    expect(moveSidebarFooterItem(preferences, "import-session", "up")).toEqual(preferences);
  });

  it("cannot hide or move Help and Settings even with stale or edited storage", () => {
    const edited = [
      { key: "settings", visible: false },
      { key: "help", visible: false },
      { key: "hosts", visible: false },
      { key: "hosts", visible: true },
      { key: "unknown", visible: true },
    ];
    const normalized = resolveSidebarFooterItems(edited).map(({ key, visible }) => ({
      key,
      visible,
    }));
    expect(normalized).toEqual([
      { key: "new", visible: true },
      { key: "add-project", visible: false },
      { key: "search", visible: true },
      { key: "hosts", visible: false },
      { key: "import-session", visible: false },
      { key: "help", visible: true },
      { key: "settings", visible: true },
    ]);
    expect(setSidebarFooterItemVisible(edited, "help", false)).toEqual(normalized);
    expect(setSidebarFooterItemVisible(edited, "settings", false)).toEqual(normalized);
    expect(moveSidebarFooterItem(edited, "help", "up")).toEqual(normalized);
    expect(moveSidebarFooterItem(edited, "settings", "up")).toEqual(normalized);
  });
});
