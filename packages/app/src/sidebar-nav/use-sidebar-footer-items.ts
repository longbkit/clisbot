import { useCallback, useMemo } from "react";
import { useAppSettings } from "@/hooks/use-settings";
import {
  moveSidebarFooterItem,
  resolveSidebarFooterItems,
  setSidebarFooterItemVisible,
} from "./footer-model";

export function useSidebarFooterItems() {
  const { settings, updateSettings } = useAppSettings();
  const items = useMemo(
    () => resolveSidebarFooterItems(settings.sidebarFooterItems),
    [settings.sidebarFooterItems],
  );
  const setVisible = useCallback(
    (key: string, visible: boolean) => {
      void updateSettings((current) => ({
        sidebarFooterItems: setSidebarFooterItemVisible(current.sidebarFooterItems, key, visible),
      }));
    },
    [updateSettings],
  );
  const move = useCallback(
    (key: string, direction: "up" | "down") => {
      void updateSettings((current) => ({
        sidebarFooterItems: moveSidebarFooterItem(current.sidebarFooterItems, key, direction),
      }));
    },
    [updateSettings],
  );
  return { items, setVisible, move };
}
