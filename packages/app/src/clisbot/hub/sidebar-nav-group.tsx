import type { StyleProp, ViewStyle } from "react-native";
import { View } from "react-native";
import { SidebarNavRows } from "@/components/sidebar/sidebar-nav-rows";
import { useSidebarNavItems } from "@/sidebar-nav/use-sidebar-nav-items";
import { AutomationSidebarItem } from "./automation-sidebar-item";
import { OrganizationSidebarItem } from "./organization-sidebar-item";
import { useHubAccount } from "./account-provider";

/**
 * Upstream's nav rows plus the fusion Automations row, in one bordered group.
 *
 * `SidebarNavRows` deliberately renders nothing — not even the group wrapper — once every
 * item is hidden, so the wrapper has to be owned here: appending a row inside it would
 * otherwise leave an empty bordered box when the user hides everything and Hub is signed out.
 *
 * Automations is not a registry item, so it does not take part in the reordering and
 * visibility controls the builtin rows have. Making it one means adding a member to the
 * closed `BuiltinSidebarNavId` union and its three exhaustive records in upstream files;
 * a generic host-contributed item would be the thing to ask upstream for instead.
 */
export function SidebarNavGroup({
  style,
  onBeforeNavigate,
}: {
  style?: StyleProp<ViewStyle>;
  onBeforeNavigate?: () => void;
}) {
  const { items } = useSidebarNavItems();
  const hub = useHubAccount();
  const showsAutomations = hub.enabled && Boolean(hub.signedIn);
  if (!items.some((item) => item.visible) && !showsAutomations) return null;
  return (
    <View style={style}>
      <OrganizationSidebarItem onBeforeNavigate={onBeforeNavigate} />
      <SidebarNavRows onBeforeNavigate={onBeforeNavigate} />
      <AutomationSidebarItem onBeforeNavigate={onBeforeNavigate} />
    </View>
  );
}
