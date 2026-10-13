import { useIsMobileTabPage } from "@/clisbot/home/mobile-navigation";
import { useMemo, type ReactNode } from "react";
import { StyleSheet } from "react-native-unistyles";
import { ScreenHeader } from "./screen-header";
import { ScreenTitle } from "./screen-title";
import { CompactHeader } from "./compact-header";
import { HomeHeaderNavigation } from "@/clisbot/home/header-navigation";
import { useIsCompactFormFactor } from "@/constants/layout";

export { HomeHeaderNavigation as SidebarMenuToggle } from "@/clisbot/home/header-navigation";
export { WindowSidebarMenuToggle } from "./sidebar-menu-toggle";

interface MenuHeaderProps {
  title?: string;
  rightContent?: ReactNode;
  borderless?: boolean;
  transparent?: boolean;
}

export function MenuHeader({ title, rightContent, borderless, transparent }: MenuHeaderProps) {
  const navigationContent = useMemo(() => <HomeHeaderNavigation />, []);
  const tabPage = useIsMobileTabPage();
  const isCompact = useIsCompactFormFactor();
  if (isCompact && !tabPage) {
    return (
      <CompactHeader
        navigation="menu"
        navigationContent={navigationContent}
        title={title}
        actions={rightContent}
      />
    );
  }
  return (
    <ScreenHeader
      left={
        <>
          <HomeHeaderNavigation />
          {title && <ScreenTitle>{title}</ScreenTitle>}
        </>
      }
      right={rightContent}
      leftStyle={tabPage ? styles.leftTabPage : styles.left}
      transparent={transparent}
      borderless={borderless}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  leftTabPage: { gap: theme.spacing[2], paddingLeft: theme.spacing[2] },
  left: {
    gap: theme.spacing[2],
  },
}));
