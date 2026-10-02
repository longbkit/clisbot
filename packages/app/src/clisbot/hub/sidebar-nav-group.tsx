import { useIsCompactFormFactor } from "@/constants/layout";
import { useCallback } from "react";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import type { StyleProp, ViewStyle } from "react-native";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { ClisbotBrand } from "@/components/clisbot-brand";
import { MIN_TOUCH_TARGET_SIZE } from "@/components/ui/control-geometry";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { buildSettingsSectionRoute } from "@/utils/host-routes";
import { SidebarNavRows } from "@/components/sidebar/sidebar-nav-rows";
import { HubSidebarAccountButton } from "./sidebar-account";
import { OrganizationSidebarItem } from "./organization-sidebar-item";
import { useHubAccount } from "./account-provider";

function brandButtonStyle({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) {
  return [styles.brandButton, (hovered || pressed) && styles.brandButtonHovered];
}

/** Branding, account and organization share the top area; navigation follows below. */
export function SidebarNavGroup({
  style,
  onBeforeNavigate,
}: {
  style?: StyleProp<ViewStyle>;
  onBeforeNavigate?: () => void;
}) {
  const compact = useIsCompactFormFactor();
  const { t } = useTranslation();
  const router = useRouter();
  const hub = useHubAccount();
  const openAbout = useCallback(() => {
    onBeforeNavigate?.();
    router.push(buildSettingsSectionRoute("about"));
  }, [onBeforeNavigate, router]);
  const brandLabel = `Clisbot · ${t("settings.sections.about")}`;
  return (
    <View style={style}>
      <View style={[styles.accountRow, compact && styles.accountRowCompact]}>
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <Pressable
              onPress={openAbout}
              accessibilityRole="button"
              accessibilityLabel={brandLabel}
              testID="sidebar-clisbot-brand"
              style={brandButtonStyle}
            >
              <ClisbotBrand iconOnly />
            </Pressable>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="start" offset={8}>
            <Text style={styles.tooltipText}>{brandLabel}</Text>
          </TooltipContent>
        </Tooltip>
        {hub.enabled && (
          <>
            {hub.signedIn && (
              <View style={styles.organization}>
                <OrganizationSidebarItem onBeforeNavigate={onBeforeNavigate} />
              </View>
            )}
            <HubSidebarAccountButton />
          </>
        )}
      </View>
      <SidebarNavRows onBeforeNavigate={onBeforeNavigate} />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  accountRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
  },
  accountRowCompact: { paddingRight: MIN_TOUCH_TARGET_SIZE + theme.spacing[1] },
  organization: { flex: 1, minWidth: 0 },
  brandButton: {
    width: MIN_TOUCH_TARGET_SIZE,
    height: MIN_TOUCH_TARGET_SIZE,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    borderRadius: theme.borderRadius.xl,
  },
  brandButtonHovered: { backgroundColor: theme.colors.surfaceSidebarHover },
  tooltipText: {
    color: theme.colors.popoverForeground,
    fontSize: theme.fontSize.base,
  },
}));
