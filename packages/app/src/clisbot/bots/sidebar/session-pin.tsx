import { useCallback, useState, type ReactNode } from "react";
import {
  Pressable,
  View,
  type GestureResponderEvent,
  type PressableStateCallbackType,
} from "react-native";
import { Pin, PinOff } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative } from "@/constants/platform";
import { useBotsFeatureHosts } from "../feature";
import { useResourcePins, pinKey } from "./pins";
const Pinned = withUnistyles(PinOff);
const Unpinned = withUnistyles(Pin);
const color = (theme: import("@/styles/theme").Theme) => ({ color: theme.colors.foregroundMuted });
export function SessionPinButton({
  serverId,
  agentId,
  hovered = false,
  children,
}: {
  serverId: string;
  agentId: string;
  hovered?: boolean;
  children?: ReactNode;
}) {
  const enabled = useBotsFeatureHosts().length > 0;
  const compact = useIsCompactFormFactor() || isNative;
  const [focused, setFocused] = useState(false);
  const { pins, toggle } = useResourcePins();
  const pinned = pins.some((p) => pinKey(p) === pinKey({ kind: "session", serverId, id: agentId }));
  const onPress = useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation();
      toggle({ kind: "session", serverId, id: agentId });
    },
    [toggle, serverId, agentId],
  );
  const onFocus = useCallback(() => setFocused(true), []);
  const onBlur = useCallback(() => setFocused(false), []);
  const style = useCallback(
    ({ hovered: selfHover }: PressableStateCallbackType) => [
      styles.button,
      compact && styles.touch,
      !(hovered || focused || selfHover || compact) && styles.hidden,
    ],
    [compact, hovered, focused],
  );
  if (!enabled) return children;
  const Icon = pinned ? Pinned : Unpinned;
  return (
    <View style={[styles.slot, compact && styles.touchSlot]}>
      <View style={(hovered || focused || compact) && styles.hidden}>{children}</View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={pinned ? "Unpin session" : "Pin session"}
        onPress={onPress}
        style={style}
        onFocus={onFocus}
        onBlur={onBlur}
      >
        <Icon size={14} uniProps={color} />
      </Pressable>
    </View>
  );
}
const styles = StyleSheet.create({
  slot: { minWidth: 28, height: 20, alignItems: "flex-end", flexShrink: 0 },
  touchSlot: { minWidth: 44, height: 36 },
  button: {
    position: "absolute",
    right: -4,
    top: -6,
    width: 28,
    minHeight: 32,
    justifyContent: "center",
    alignItems: "center",
  },
  touch: { width: 44, minHeight: 44, top: -4 },
  hidden: { opacity: 0 },
});
