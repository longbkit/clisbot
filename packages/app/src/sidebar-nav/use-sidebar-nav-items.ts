import { useCallback, useMemo } from "react";
import { useAppSettings } from "@/hooks/use-settings";
import { useBotsFeatureHosts } from "@/clisbot/bots/feature";
import { useInstalledPlugins } from "@/plugins/registry";
import { groupPluginSidebarContributions } from "@/plugins/sidebar-groups";
import {
  moveSidebarNavItem,
  resolveSidebarNavItems,
  setSidebarNavItemVisible,
  type SidebarNavItem,
  type BuiltinSidebarNavId,
} from "./model";

const FUSION_BUILTIN_ORDER: readonly BuiltinSidebarNavId[] = [
  "new-workspace",
  "add-project",
  "search",
  "history",
  "schedules",
];

export interface UseSidebarNavItemsReturn {
  /** Every top-level item in display order, hidden ones included. */
  items: SidebarNavItem[];
  setVisible: (key: string, visible: boolean) => void;
  move: (key: string, direction: "up" | "down") => void;
}

export function useSidebarNavItems(): UseSidebarNavItemsReturn {
  const plugins = useInstalledPlugins();
  const { settings, updateSettings } = useAppSettings();
  const preferences = settings.sidebarNavItems;
  const fusion = useBotsFeatureHosts().length > 0;
  const builtinOrder = fusion ? FUSION_BUILTIN_ORDER : undefined;
  const pluginGroups = useMemo(() => groupPluginSidebarContributions(plugins), [plugins]);

  const items = useMemo(
    () =>
      resolveSidebarNavItems({
        pluginGroups,
        preferences,
        builtinOrder,
      }),
    [pluginGroups, preferences, builtinOrder],
  );

  const setVisible = useCallback(
    (key: string, visible: boolean) => {
      void updateSettings((current) => {
        const previous = current.sidebarNavItems;
        const currentItems = resolveSidebarNavItems({
          pluginGroups,
          preferences: previous,
          builtinOrder,
        });
        return {
          sidebarNavItems: setSidebarNavItemVisible({
            items: currentItems,
            key,
            visible,
            previous,
          }),
        };
      });
    },
    [pluginGroups, updateSettings, builtinOrder],
  );

  const move = useCallback(
    (key: string, direction: "up" | "down") => {
      void updateSettings((current) => {
        const previous = current.sidebarNavItems;
        const currentItems = resolveSidebarNavItems({
          pluginGroups,
          preferences: previous,
          builtinOrder,
        });
        return {
          sidebarNavItems: moveSidebarNavItem({
            items: currentItems,
            key,
            direction,
            previous,
          }),
        };
      });
    },
    [pluginGroups, updateSettings, builtinOrder],
  );

  return { items, setVisible, move };
}
