import { useIsCompactFormFactor } from "@/constants/layout";
import { useCallback } from "react";
import { usePathname, useRouter } from "expo-router";
import type { StyleProp, ViewStyle } from "react-native";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { MIN_TOUCH_TARGET_SIZE } from "@/components/ui/control-geometry";
import { SidebarNavRows } from "@/components/sidebar/sidebar-nav-rows";
import { HubSidebarTopRow } from "./sidebar-account";
import { useHubAccount } from "./account-provider";
import { PersonalHubSwitcher } from "./personal-hub-switcher";
import { HOME_V2_ENABLED } from "@/clisbot/home/feature";

const PERSONAL_HUB_ROUTE = "/settings/hub/overview";

/**
 * One top row (Clisbot mark, account avatar) opens the account; navigation follows below. The
 * phone sidebar passes `rows={false}` and puts `SidebarNavRows` at the top of its scrolling list.
 */
export function SidebarNavGroup({
  style,
  rows = true,
  onBeforeNavigate,
}: {
  style?: StyleProp<ViewStyle>;
  rows?: boolean;
  onBeforeNavigate?: () => void;
}) {
  const compact = useIsCompactFormFactor();
  const router = useRouter();
  const pathname = usePathname();
  const hub = useHubAccount();
  const openPersonalHub = useCallback(() => {
    onBeforeNavigate?.();
    router.push(PERSONAL_HUB_ROUTE);
  }, [onBeforeNavigate, router]);
  const personal = hub.enabled && hub.connection?.accountAuthentication === "personal";
  return (
    <View style={style}>
      <View style={[styles.topRow, compact && !HOME_V2_ENABLED && styles.topRowCompact]}>
        {personal ? (
          <PersonalHubSwitcher
            isActive={pathname === PERSONAL_HUB_ROUTE}
            onPress={openPersonalHub}
          />
        ) : (
          <HubSidebarTopRow onBeforeNavigate={onBeforeNavigate} />
        )}
      </View>
      {rows ? <SidebarNavRows onBeforeNavigate={onBeforeNavigate} /> : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing[2],
  },
  topRowCompact: { paddingRight: MIN_TOUCH_TARGET_SIZE + theme.spacing[1] },
}));
