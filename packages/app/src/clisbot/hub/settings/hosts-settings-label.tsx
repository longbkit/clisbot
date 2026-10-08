import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { StatusBadge } from "@/components/ui/status-badge";
import { useHostsSettingsInventory } from "./hosts-settings-inventory";

/** Online means this app can reach the Host, independently of its Hub link. */
export function HostsConnectionCount({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const { onlineCount, totalCount } = useHostsSettingsInventory();
  const dot = useMemo(
    () => <View style={[styles.dot, onlineCount > 0 ? styles.activeDot : styles.inactiveDot]} />,
    [onlineCount],
  );
  const label = compact
    ? `${onlineCount}/${totalCount}`
    : t("hub.settings.hostsCount.full", { online: onlineCount, total: totalCount });
  return (
    <View
      accessibilityLabel={t("hub.settings.hostsCount.accessibilityLabel", {
        online: onlineCount,
        total: totalCount,
      })}
    >
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
