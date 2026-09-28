import { useIsCompactFormFactor } from "@/constants/layout";
import type { StyleProp, ViewStyle } from "react-native";
import { View } from "react-native";
import { SidebarNavRows } from "@/components/sidebar/sidebar-nav-rows";
import { useSidebarNavItems } from "@/sidebar-nav/use-sidebar-nav-items";
import { HubSidebarAccountButton } from "./sidebar-account";
import { OrganizationSidebarItem } from "./organization-sidebar-item";
import { useHubAccount } from "./account-provider";

/** Account and organization share the top area; Automations uses the existing schedules nav slot. */
export function SidebarNavGroup({
  style,
  onBeforeNavigate,
}: {
  style?: StyleProp<ViewStyle>;
  onBeforeNavigate?: () => void;
}) {
  const compact = useIsCompactFormFactor();
  const { items } = useSidebarNavItems();
  const hub = useHubAccount();
  if (!items.some((item) => item.visible) && !hub.enabled) return null;
  return (
    <View style={style}>
      {hub.enabled && (
        <View style={[accountRowStyle, compact && accountRowCompactStyle]}>
          {hub.signedIn && (
            <View style={organizationStyle}>
              <OrganizationSidebarItem onBeforeNavigate={onBeforeNavigate} />
            </View>
          )}
          <HubSidebarAccountButton />
        </View>
      )}
      <SidebarNavRows onBeforeNavigate={onBeforeNavigate} />
    </View>
  );
}

const accountRowStyle = {
  flexDirection: "row",
  alignItems: "center",
  paddingHorizontal: 8,
} as const;
const organizationStyle = { flex: 1 };

const accountRowCompactStyle = { paddingRight: 52 };
