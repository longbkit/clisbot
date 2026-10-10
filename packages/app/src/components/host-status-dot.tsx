import { View } from "react-native";
import { Monitor, Server } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useLocalDaemonServerId } from "@/hooks/use-is-local-daemon";
import { formatConnectionStatus } from "@/utils/daemons";
import {
  type HostRuntimeConnectionStatus,
  useHostRuntimeConnectionStatus,
} from "@/runtime/host-runtime";

export function HostStatusDot({ serverId }: { serverId: string }) {
  const status = useHostRuntimeConnectionStatus(serverId);
  return <ConnectionStatusDot status={status} />;
}

/** The dot for a status a caller already has, e.g. one adjusted for a stalled connection. */
export function ConnectionStatusDot({
  status,
  small = false,
}: {
  status: HostRuntimeConnectionStatus;
  small?: boolean;
}) {
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={formatConnectionStatus(status)}
      style={[styles.dot, small && styles.dotSmall, statusStyle(status)]}
    />
  );
}

/** A Host's mark wherever a Host is named: this computer or a remote one, with its status dot. */
export function HostMark({ serverId, size }: { serverId: string; size: number }) {
  const status = useHostRuntimeConnectionStatus(serverId);
  const local = useLocalDaemonServerId() === serverId;
  return <HostGlyphMark local={local} status={status} size={size} />;
}

export function HostGlyphMark({
  local,
  status,
  size,
}: {
  local: boolean;
  status: HostRuntimeConnectionStatus;
  size: number;
}) {
  return (
    <View style={styles.mark}>
      <MutedHostGlyph Icon={local ? Monitor : Server} size={size} />
      <View style={styles.markDot}>
        <ConnectionStatusDot status={status} small />
      </View>
    </View>
  );
}

function HostGlyph({ Icon, size, color }: { Icon: typeof Server; size: number; color?: string }) {
  return <Icon size={size} color={color} />;
}
const MutedHostGlyph = withUnistyles(HostGlyph, (theme) => ({
  color: theme.colors.foregroundMuted,
}));

function statusStyle(status: HostRuntimeConnectionStatus) {
  if (status === "online") return styles.dotOnline;
  if (status === "connecting") return styles.dotConnecting;
  return styles.dotOffline;
}

const styles = StyleSheet.create((theme) => ({
  dot: {
    width: 8,
    height: 8,
    borderRadius: theme.borderRadius.full,
  },
  dotSmall: {
    width: 6,
    height: 6,
  },
  mark: {
    alignItems: "center",
    justifyContent: "center",
  },
  markDot: {
    position: "absolute",
    right: -2,
    bottom: -1,
  },
  dotOnline: {
    backgroundColor: theme.colors.statusSuccess,
  },
  dotConnecting: {
    backgroundColor: theme.colors.statusWarning,
  },
  dotOffline: {
    backgroundColor: theme.colors.statusDanger,
  },
}));
