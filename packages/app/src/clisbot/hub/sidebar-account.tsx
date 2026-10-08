import { usePathname, useRouter } from "expo-router";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { buildSettingsSectionRoute } from "@/utils/host-routes";
import { useHubAccount } from "./account-provider";
import { buildHubSettingsRoute } from "./navigation";
import {
  resolveHubSidebarAccountPresentation,
  type HubSidebarAccountPresentation,
} from "./sidebar-account-presentation";
import { SidebarTopRow } from "./sidebar-top-row";

/**
 * The sidebar's top row on a managed Hub: one button with the Clisbot mark and, once signed in,
 * the account avatar. It opens the Hub account page, which is also where signing in starts.
 * Without Hub support the row opens About.
 */
export function HubSidebarTopRow({ onBeforeNavigate }: { onBeforeNavigate?: () => void }) {
  const { t } = useTranslation();
  const hub = useHubAccount();
  const router = useRouter();
  const pathname = usePathname();
  const presentation = resolveHubSidebarAccountPresentation({
    enabled: hub.enabled,
    account: hub.signedIn?.account ?? null,
    ...(hub.signedIn ? { organizationName: hub.signedIn.organization.name } : {}),
  });
  const route = hub.enabled ? buildHubSettingsRoute("account") : buildSettingsSectionRoute("about");
  const open = useCallback(() => {
    onBeforeNavigate?.();
    router.push(route);
  }, [onBeforeNavigate, route, router]);
  const accessibilityLabel =
    presentation?.accessibilityLabel ??
    (hub.enabled
      ? t("hub.account.sidebar.signInToAccount")
      : `Clisbot · ${t("settings.sections.about")}`);
  const row = (
    <SidebarTopRow
      label="Clisbot"
      isActive={pathname === route}
      onPress={open}
      accessibilityLabel={accessibilityLabel}
      testID="sidebar-hub-account"
    >
      <AccountMark presentation={presentation} hubEnabled={hub.enabled} />
    </SidebarTopRow>
  );
  if (presentation === null) return row;
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>{row}</TooltipTrigger>
      <TooltipContent side="bottom" align="end" offset={8}>
        <Text style={styles.tooltipText}>{presentation.tooltip}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

function AccountMark({
  presentation,
  hubEnabled,
}: {
  presentation: HubSidebarAccountPresentation | null;
  hubEnabled: boolean;
}) {
  const { t } = useTranslation();
  if (presentation !== null) {
    return (
      <Text numberOfLines={1} style={[styles.avatar, { backgroundColor: presentation.color }]}>
        {presentation.initials}
      </Text>
    );
  }
  if (!hubEnabled) return null;
  return <Text style={styles.signInLabel}>{t("hub.account.sidebar.signIn")}</Text>;
}

const styles = StyleSheet.create((theme) => ({
  signInLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
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
    overflow: "hidden",
  },
  tooltipText: {
    color: theme.colors.popoverForeground,
    fontSize: theme.fontSize.base,
  },
}));
