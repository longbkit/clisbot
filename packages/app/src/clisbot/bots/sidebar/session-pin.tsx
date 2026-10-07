import { useCallback } from "react";
import {
  Pressable,
  type GestureResponderEvent,
  type PressableStateCallbackType,
} from "react-native";
import { Pin, PinOff } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative } from "@/constants/platform";
import type { Theme } from "@/styles/theme";
import { useBotsFeatureHosts } from "../feature";
import { useResourcePins, pinKey } from "./pins";

const Pinned = withUnistyles(PinOff);
const Unpinned = withUnistyles(Pin);
const color = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/**
 * Pins or unpins a session. Where it shows is the line's business — on hover over the line's
 * end on desktop, always on touch (`SessionLineTrailing`); this is only the button.
 */
export function SessionPinButton({ serverId, agentId }: { serverId: string; agentId: string }) {
  const enabled = useBotsFeatureHosts().length > 0;
  const compact = useIsCompactFormFactor() || isNative;
  const { pins, toggle } = useResourcePins();
  const pinned = pins.some((p) => pinKey(p) === pinKey({ kind: "session", serverId, id: agentId }));
  const onPress = useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation();
      toggle({ kind: "session", serverId, id: agentId });
    },
    [toggle, serverId, agentId],
  );
  const style = useCallback(
    ({ hovered = false, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.button,
      compact && styles.touch,
      (hovered || pressed) && styles.hovered,
    ],
    [compact],
  );
  if (!enabled) return null;
  const Icon = pinned ? Pinned : Unpinned;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={pinned ? "Unpin session" : "Pin session"}
      onPress={onPress}
      style={style}
      testID={`sidebar-session-pin-${agentId}`}
    >
      <Icon size={14} uniProps={color} />
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  button: {
    width: 28,
    height: 28,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: theme.borderRadius.md,
  },
  touch: { width: 44, height: 44 },
  hovered: { backgroundColor: theme.colors.surface3 },
}));
