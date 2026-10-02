import type { SidebarNavPreference } from "./model";

const FOOTER_ITEMS = [
  { key: "new", group: "actions", visible: true, labelKey: "sidebar.actions.new" },
  { key: "add-project", group: "actions", visible: false, labelKey: "sidebar.actions.addProject" },
  { key: "search", group: "actions", visible: true, labelKey: "sidebar.sections.search" },
  { key: "hosts", group: "controls", visible: true, labelKey: "sidebar.actions.hosts" },
  { key: "import-session", group: "controls", visible: false, labelKey: "importSession.title" },
  { key: "help", group: "fixed", visible: true, labelKey: "sidebar.help.trigger" },
  { key: "settings", group: "fixed", visible: true, labelKey: "sidebar.actions.settings" },
] as const;

export type SidebarFooterId = (typeof FOOTER_ITEMS)[number]["key"];
export type SidebarFooterItem = Omit<(typeof FOOTER_ITEMS)[number], "visible"> & {
  visible: boolean;
};

/** Left actions, right controls, then the permanently visible Help and Settings. */
export function resolveSidebarFooterItems(
  preferences: readonly SidebarNavPreference[],
): SidebarFooterItem[] {
  const items: SidebarFooterItem[] = [];
  for (const group of ["actions", "controls", "fixed"] as const) {
    const defaults = FOOTER_ITEMS.filter((item) => item.group === group);
    const placed = new Set<string>();
    if (group !== "fixed") {
      for (const preference of preferences) {
        const item = defaults.find((candidate) => candidate.key === preference.key);
        if (!item || placed.has(item.key)) continue;
        items.push({ ...item, visible: preference.visible });
        placed.add(item.key);
      }
    }
    items.push(...defaults.filter((item) => !placed.has(item.key)));
  }
  return items;
}

export function canMoveSidebarFooterItem(
  items: readonly SidebarFooterItem[],
  key: string,
  direction: "up" | "down",
): boolean {
  const index = items.findIndex((item) => item.key === key);
  const item = items[index];
  const neighbor = items[index + (direction === "up" ? -1 : 1)];
  return Boolean(item && neighbor && item.group !== "fixed" && item.group === neighbor.group);
}

export function setSidebarFooterItemVisible(
  preferences: readonly SidebarNavPreference[],
  key: string,
  visible: boolean,
): SidebarNavPreference[] {
  return resolveSidebarFooterItems(preferences).map((item) => ({
    key: item.key,
    visible: item.key === key && item.group !== "fixed" ? visible : item.visible,
  }));
}

export function moveSidebarFooterItem(
  preferences: readonly SidebarNavPreference[],
  key: string,
  direction: "up" | "down",
): SidebarNavPreference[] {
  const items = resolveSidebarFooterItems(preferences);
  if (canMoveSidebarFooterItem(items, key, direction)) {
    const from = items.findIndex((item) => item.key === key);
    const to = from + (direction === "up" ? -1 : 1);
    [items[from], items[to]] = [items[to], items[from]];
  }
  return items.map((item) => ({ key: item.key, visible: item.visible }));
}

export function sidebarFooterShortcutAction(key: SidebarFooterId): string | null {
  if (key === "add-project") return "new-agent";
  if (key === "search") return "toggle-command-center";
  if (key === "settings") return "toggle-settings";
  return null;
}
