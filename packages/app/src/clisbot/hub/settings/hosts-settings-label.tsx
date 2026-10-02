import { useMemo } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { StatusBadge } from "@/components/ui/status-badge";
import { useHostsSettingsInventory } from "./hosts-settings-inventory";

/** Online means this app can reach the Host, independently of its Hub link. */
export function HostsConnectionCount({ compact = false }: { compact?: boolean }) {
  const { onlineCount, totalCount } = useHostsSettingsInventory();
  const dot = useMemo(
    () => <View style={[styles.dot, onlineCount > 0 ? styles.activeDot : styles.inactiveDot]} />,
    [onlineCount],
  );
  const label = compact
    ? `${onlineCount}/${totalCount}`
    : `${onlineCount} active / ${totalCount} total`;
  return (
    <View accessibilityLabel={`${onlineCount} online out of ${totalCount} Hosts`}>
      <StatusBadge label={label} leading={dot} />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  dot: {
    width: 8,
    height: 8,
    borderRadius: theme.borderRadius.full,
  },
  activeDot: {
    backgroundColor: theme.colors.statusSuccess,
  },
  inactiveDot: {
    backgroundColor: theme.colors.foregroundMuted,
  },
}));
