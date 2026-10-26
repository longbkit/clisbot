import { MenuHeader } from "@/components/headers/menu-header";
import { useIsCompactFormFactor } from "@/constants/layout";
import { HOME_V2_ENABLED } from "./feature";
import { MobileToolbar } from "./mobile-toolbar";
import { NAVIGATION_V2_ENABLED } from "@/clisbot/navigation/feature";
import { NavigationHomeHeader } from "@/clisbot/navigation/home-header";

export function HomeHeader() {
  const compact = useIsCompactFormFactor();
  if (NAVIGATION_V2_ENABLED) return <NavigationHomeHeader />;
  if (HOME_V2_ENABLED && compact) return <MobileToolbar />;
  return <MenuHeader title="Home" borderless />;
}
