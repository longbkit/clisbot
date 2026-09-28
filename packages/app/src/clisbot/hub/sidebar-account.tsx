import { UserRound } from "lucide-react-native";
import { router } from "expo-router";
import { useCallback } from "react";
import { Pressable, Text, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsCompactFormFactor } from "@/constants/layout";
import { usePanelStore } from "@/stores/panel-store";
import { useHubAccount } from "./account-provider";
import { buildHubSettingsRoute } from "./navigation";
import {
  resolveHubSidebarAccountPresentation,
  type HubSidebarAccountPresentation,
} from "./sidebar-account-presentation";

const AccountIcon = withUnistyles(UserRound);

function triggerStyle({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.trigger, Boolean(hovered || pressed) && styles.triggerHovered];
}

export function HubSidebarAccountButton() {
  const hub = useHubAccount();
  const presentation = resolveHubSidebarAccountPresentation({
    enabled: hub.enabled,
    account: hub.signedIn?.account ?? null,
    ...(hub.signedIn ? { organizationName: hub.signedIn.organization.name } : {}),
  });
  if (!hub.enabled) return null;

  return <SignedInHubSidebarAccountButton presentation={presentation ?? signedOutPresentation} />;
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

  const accountTriggerStyle = useCallback(
    (state: PressableStateCallbackType & { hovered?: boolean }) => [
      triggerStyle(state),
      !presentation.initials && styles.signInTrigger,
    ],
    [presentation.initials],
  );
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <Pressable
          accessibilityLabel={presentation.accessibilityLabel}
          accessibilityRole="button"
          nativeID="sidebar-hub-account"
          onPress={handlePress}
          style={accountTriggerStyle}
          testID="sidebar-hub-account"
        >
          {presentation.initials ? (
            <Text
              numberOfLines={1}
              style={[styles.avatar, { backgroundColor: presentation.color }]}
            >
              {presentation.initials}
            </Text>
          ) : (
            <>
              <AccountIcon size={20} uniProps={accountIconColor} />
              <Text style={styles.signInLabel}>Sign in</Text>
            </>
          )}
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
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.full,
  },
  signInTrigger: {
    flex: 1,
    width: "auto",
    flexDirection: "row",
    justifyContent: "flex-start",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
  },
  signInLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
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

const signedOutPresentation = {
  accessibilityLabel: "Sign in to your account",
  color: "transparent",
  initials: "",
  tooltip: "Sign in to your account",
};
const accountIconColor = (theme: import("@/styles/theme").Theme) => ({
  color: theme.colors.foregroundMuted,
});
