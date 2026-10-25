import { describe, expect, it } from "vitest";
import type { PluginSidebarGroup } from "@/plugins/sidebar-groups";
import type { SidebarNavItem } from "@/sidebar-nav/model";
import { resolveNavigationSections, sectionForPath, sectionHasListPane } from "./sections";

const plugin = (key: string, visible = true): SidebarNavItem =>
  ({
    kind: "plugin",
    key,
    visible,
    group: { pluginId: key } as unknown as PluginSidebarGroup,
  }) as SidebarNavItem;
const keys = (sections: { key: string }[]) => sections.map((section) => section.key);

describe("resolveNavigationSections", () => {
  it("builds the rail, phone tabs and More from one registry", () => {
    const resolved = resolveNavigationSections({
      headerItems: [plugin("plugin:a:1"), plugin("plugin:b:1", false)],
      footerItems: [plugin("plugin:c:1")],
      usageEnabled: false,
      connectorsEnabled: true,
    });
    expect(keys(resolved.railPrimary)).toEqual([
      "home",
      "chats",
      "work",
      "schedules",
      "tasks",
      "connectors",
      "plugin:a:1",
    ]);
    expect(keys(resolved.railBottom)).toEqual(["plugin:c:1", "hosts", "help", "settings"]);
    expect(keys(resolved.phoneTabs)).toEqual(["home", "chats", "work", "schedules"]);
    expect(keys(resolved.more)).toEqual([
      "tasks",
      "connectors",
      "plugin:a:1",
      "plugin:c:1",
      "hosts",
      "help",
      "settings",
    ]);
  });

  it("shows Usage only when enabled and Connectors only when a Host offers them", () => {
    const resolved = resolveNavigationSections({
      headerItems: [],
      footerItems: [],
      usageEnabled: true,
      connectorsEnabled: false,
    });
    expect(keys(resolved.railBottom)).toEqual(["usage", "hosts", "help", "settings"]);
    expect(keys(resolved.railPrimary)).not.toContain("connectors");
  });

  it("marks Tasks as a preview section", () => {
    const { railPrimary } = resolveNavigationSections({
      headerItems: [],
      footerItems: [],
      usageEnabled: false,
      connectorsEnabled: false,
    });
    expect(railPrimary.find((section) => section.key === "tasks")).toMatchObject({
      status: "preview",
      href: "/tasks",
    });
  });
});

describe("sectionForPath", () => {
  it("maps routes, including legacy ones, to sections", () => {
    expect(sectionForPath("/sessions")).toBe("home");
    expect(sectionForPath("/open-project")).toBe("home");
    expect(sectionForPath("/automations")).toBe("schedules");
    expect(sectionForPath("/h/s1/chat/c1")).toBe("chats");
    expect(sectionForPath("/h/s1/workspace/w1")).toBe("work");
    expect(sectionForPath("/h/s1/workspace/w1", "chats")).toBe("chats");
    expect(sectionForPath("/settings/general")).toBe("settings");
  });

  it("gives list panes to Chats and Work only", () => {
    expect(sectionHasListPane("chats") && sectionHasListPane("work")).toBe(true);
    expect(sectionHasListPane("home") || sectionHasListPane("schedules")).toBe(false);
  });
});
