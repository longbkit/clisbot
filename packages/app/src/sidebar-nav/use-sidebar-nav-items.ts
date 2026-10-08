import { useCallback, useMemo } from "react";
import { useAppSettings } from "@/hooks/use-settings";
import type { AppSettings } from "@/hooks/use-settings/storage";
import { useBotsFeatureHosts } from "@/clisbot/bots/feature";
import { useInstalledPlugins } from "@/plugins/registry";
import { groupPluginSidebarItems } from "@/plugins/sidebar-groups";
import {
  moveSidebarNavItem,
  resolveSidebarNavItems,
  setSidebarNavItemVisible,
  type BuiltinSidebarItemId,
  type SidebarNavItem,
  type SidebarSection,
} from "./model";

/** Header order on Hosts with Bots and Chats: Search sits beside New and Add project. */
const FUSION_HEADER_ORDER: readonly BuiltinSidebarItemId<"header">[] = [
  "new-workspace",
  "add-project",
  "search",
  "history",
  "schedules",
];

const PREFERENCE_FIELDS = {
  header: "sidebarNavItems",
  footer: "sidebarFooterItems",
} as const satisfies Record<SidebarSection, keyof AppSettings>;

export interface UseSidebarNavItemsReturn<Section extends SidebarSection> {
  /** Every item in the section in display order, hidden ones included. */
  items: SidebarNavItem<Section>[];
  setVisible: (key: string, visible: boolean) => void;
  move: (key: string, direction: "up" | "down") => void;
}

export function useSidebarNavItems<Section extends SidebarSection>(
  section: Section,
): UseSidebarNavItemsReturn<Section> {
  const plugins = useInstalledPlugins();
  const { settings, updateSettings } = useAppSettings();
  const field = PREFERENCE_FIELDS[section];
  const preferences = settings[field];
  const fusion = useBotsFeatureHosts().length > 0;
  const builtinOrder = (fusion && section === "header" ? FUSION_HEADER_ORDER : undefined) as
    | readonly BuiltinSidebarItemId<Section>[]
    | undefined;
  const pluginGroups = useMemo(() => groupPluginSidebarItems(plugins, section), [plugins, section]);

  const items = useMemo(
    () => resolveSidebarNavItems({ section, pluginGroups, preferences, builtinOrder }),
    [builtinOrder, pluginGroups, preferences, section],
  );

  const setVisible = useCallback(
    (key: string, visible: boolean) => {
      void updateSettings((current) => {
        const previous = current[field];
        const currentItems = resolveSidebarNavItems({
          section,
          pluginGroups,
          preferences: previous,
          builtinOrder,
        });
        return {
          [field]: setSidebarNavItemVisible({ items: currentItems, key, visible, previous }),
        };
      });
    },
    [builtinOrder, field, pluginGroups, section, updateSettings],
  );

  const move = useCallback(
    (key: string, direction: "up" | "down") => {
      void updateSettings((current) => {
        const previous = current[field];
        const currentItems = resolveSidebarNavItems({
          section,
          pluginGroups,
          preferences: previous,
          builtinOrder,
        });
        return {
          [field]: moveSidebarNavItem({ items: currentItems, key, direction, previous }),
        };
      });
    },
    [builtinOrder, field, pluginGroups, section, updateSettings],
  );

  return { items, setVisible, move };
}
