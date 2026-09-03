import { router } from "expo-router";
import { useCallback } from "react";
import { Pressable, Text, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsCompactFormFactor } from "@/constants/layout";
import { usePanelStore } from "@/stores/panel-store";
import { useHubAccount } from "./account-provider";
import { buildHubSettingsRoute } from "./navigation";
import {
  resolveHubSidebarAccountPresentation,
  type HubSidebarAccountPresentation,
} from "./sidebar-account-presentation";

function triggerStyle({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.trigger, Boolean(hovered || pressed) && styles.triggerHovered];
}

export function HubSidebarAccountButton() {
  const hub = useHubAccount();
  const presentation = resolveHubSidebarAccountPresentation({
    enabled: hub.enabled,
    account: hub.signedIn?.account ?? null,
  });
  if (presentation === null) return null;

  return <SignedInHubSidebarAccountButton presentation={presentation} />;
}

function SignedInHubSidebarAccountButton({
  presentation,
}: {
  presentation: HubSidebarAccountPresentation;
}) {
  const isCompact = useIsCompactFormFactor();
  const closeMobileSidebar = usePanelStore((state) => state.showMobileAgent);
  const handlePress = useCallback(() => {
    if (isCompact) closeMobileSidebar();
    router.push(buildHubSettingsRoute("account"));
  }, [closeMobileSidebar, isCompact]);

  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <Pressable
          accessibilityLabel={presentation.accessibilityLabel}
          accessibilityRole="button"
          nativeID="sidebar-hub-account"
          onPress={handlePress}
          style={triggerStyle}
          testID="sidebar-hub-account"
        >
          <Text numberOfLines={1} style={[styles.avatar, { backgroundColor: presentation.color }]}>
            {presentation.initials}
          </Text>
        </Pressable>
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        <Text style={styles.tooltipText}>{presentation.tooltip}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

const styles = StyleSheet.create((theme) => ({
  trigger: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.full,
  },
  triggerHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  avatar: {
    width: 22,
    height: 22,
    borderRadius: theme.borderRadius.full,
    color: theme.colors.palette.white,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    lineHeight: 22,
    textAlign: "center",
  },
  tooltipText: {
    color: theme.colors.popoverForeground,
    fontSize: theme.fontSize.base,
  },
}));
