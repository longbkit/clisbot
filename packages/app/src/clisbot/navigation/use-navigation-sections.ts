import { useMemo } from "react";
import { useConnectorsFeatureHosts } from "@/clisbot/connectors/feature";
import { useSidebarFooterItems } from "@/sidebar-nav/use-sidebar-footer-items";
import { useSidebarNavItems } from "@/sidebar-nav/use-sidebar-nav-items";
import { resolveNavigationSections } from "./sections";

/**
 * The registry resolved against the reader's existing sidebar preferences: plugin entries keep
 * their order and visibility, and Usage follows the footer's Usage icon switch.
 */
export function useNavigationSections() {
  const header = useSidebarNavItems("header");
  const footer = useSidebarNavItems("footer");
  const footerBar = useSidebarFooterItems();
  const connectors = useConnectorsFeatureHosts().length > 0;
  const usageEnabled = footerBar.items.some((item) => item.key === "usage-icon" && item.visible);
  return useMemo(
    () =>
      resolveNavigationSections({
        headerItems: header.items,
        footerItems: footer.items,
        usageEnabled,
        connectorsEnabled: connectors,
      }),
    [header.items, footer.items, usageEnabled, connectors],
  );
}
