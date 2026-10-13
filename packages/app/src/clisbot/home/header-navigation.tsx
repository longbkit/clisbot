import type { ComponentProps } from "react";
import { SidebarMenuToggle } from "@/components/headers/sidebar-menu-toggle";
import { useIsCompactFormFactor } from "@/constants/layout";
import { HOME_V2_ENABLED } from "./feature";
import { MobileBack } from "./mobile-navigation";

/** Home phones navigate through tabs and Back; the generic sidebar toggle stays runtime-neutral. */
export function HomeHeaderNavigation(props: ComponentProps<typeof SidebarMenuToggle>) {
  const isCompact = useIsCompactFormFactor();
  if (HOME_V2_ENABLED && isCompact) return <MobileBack />;
  return <SidebarMenuToggle {...props} />;
}
