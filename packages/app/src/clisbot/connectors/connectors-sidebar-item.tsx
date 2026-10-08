import { useCallback } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { usePathname, useRouter } from "expo-router";
import { Blocks } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { SidebarHeaderRow } from "@/components/sidebar/sidebar-header-row";
import { useConnectorsFeatureHosts } from "./feature";

/**
 * The sidebar entry to Connectors, shown once any Host offers them. `groupStyle` wraps it in the
 * nav group's frame when it is the group's only row.
 */
export function ConnectorsSidebarItem({
  onBeforeNavigate,
  groupStyle,
}: {
  onBeforeNavigate?: () => void;
  groupStyle?: StyleProp<ViewStyle>;
}) {
  const { t } = useTranslation();
  const hosts = useConnectorsFeatureHosts();
  const router = useRouter();
  const pathname = usePathname();
  const open = useCallback(() => {
    onBeforeNavigate?.();
    router.push("/connectors");
  }, [onBeforeNavigate, router]);
  if (hosts.length === 0) return null;
  const row = (
    <SidebarHeaderRow
      icon={Blocks}
      label={t("connectors.screen.common.connectors")}
      onPress={open}
      isActive={pathname === "/connectors"}
      testID="sidebar-connectors"
      variant="compact"
    />
  );
  return groupStyle ? <View style={groupStyle}>{row}</View> : row;
}
