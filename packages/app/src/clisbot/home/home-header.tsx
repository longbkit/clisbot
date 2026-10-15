import { MenuHeader } from "@/components/headers/menu-header";
import { useIsCompactFormFactor } from "@/constants/layout";
import { HOME_V2_ENABLED } from "./feature";
import { MobileToolbar } from "./mobile-toolbar";

export function HomeHeader() {
  const compact = useIsCompactFormFactor();
  if (HOME_V2_ENABLED && compact) return <MobileToolbar />;
  return <MenuHeader title="Home" borderless />;
}
