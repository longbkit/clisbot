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

const PERSONAL_HUB_ROUTE = "/settings/hub/overview";

/** One top row (Clisbot mark, account avatar) opens the account; navigation follows below. */
export function SidebarNavGroup({
  style,
  onBeforeNavigate,
}: {
  style?: StyleProp<ViewStyle>;
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
      <View style={[styles.topRow, compact && styles.topRowCompact]}>
        {personal ? (
          <PersonalHubSwitcher
            isActive={pathname === PERSONAL_HUB_ROUTE}
            onPress={openPersonalHub}
          />
        ) : (
          <HubSidebarTopRow onBeforeNavigate={onBeforeNavigate} />
        )}
      </View>
      <SidebarNavRows onBeforeNavigate={onBeforeNavigate} />
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
