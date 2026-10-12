import { HOME_V2_ENABLED } from "@/clisbot/home/feature";
import { usePathname, useRouter } from "expo-router";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { buildSettingsSectionRoute } from "@/utils/host-routes";
import { isHubUnreachable } from "@/device-access/unavailable-hub";
import { useHubProfiles } from "@/device-access/hub-profiles";
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
  const { profiles } = useHubProfiles();
  const presentation = resolveHubSidebarAccountPresentation({
    enabled: hub.enabled,
    account: hub.signedIn?.account ?? null,
    ...(hub.signedIn ? { organizationName: hub.signedIn.organization.name } : {}),
  });
  // The selected Hub has no state at all: it cannot be reached, so signing in would not help.
  const unreachable = hub.enabled && isHubUnreachable(hub);
  const route = hubTopRowRoute(hub.enabled, unreachable);
  const open = useCallback(() => {
    onBeforeNavigate?.();
    router.push(route);
  }, [onBeforeNavigate, route, router]);
  let fallbackLabel = HOME_V2_ENABLED
    ? "Clisbot · Hubs"
    : `Clisbot · ${t("settings.sections.about")}`;
  if (hub.enabled) fallbackLabel = t("hub.account.sidebar.signInToAccount");
  if (unreachable) fallbackLabel = t("hub.account.sidebar.hubUnavailable");
  const accessibilityLabel = presentation?.accessibilityLabel ?? fallbackLabel;
  // Home V2 names where you are: the signed-in organization, else the selected Hub, else Clisbot.
  const hubName = profiles.find((profile) => `hub://${profile.hubId}` === hub.origin)?.label;
  const label = HOME_V2_ENABLED
    ? (hub.signedIn?.organization.name ?? (hub.enabled ? hubName : undefined) ?? "Clisbot")
    : "Clisbot";
  const row = (
    <SidebarTopRow
      label={label}
      isActive={pathname === route}
      onPress={open}
      accessibilityLabel={accessibilityLabel}
      testID="sidebar-hub-account"
    >
      <AccountMark presentation={presentation} hubEnabled={hub.enabled} unreachable={unreachable} />
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

function hubTopRowRoute(enabled: boolean, unreachable: boolean) {
  if (!enabled)
    return HOME_V2_ENABLED ? buildHubSettingsRoute("hubs") : buildSettingsSectionRoute("about");
  return unreachable ? buildHubSettingsRoute("hubs") : buildHubSettingsRoute("account");
}

function AccountMark({
  presentation,
  hubEnabled,
  unreachable,
}: {
  presentation: HubSidebarAccountPresentation | null;
  hubEnabled: boolean;
  unreachable: boolean;
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
  return (
    <Text style={[styles.signInLabel, unreachable && HOME_V2_ENABLED && styles.unavailable]}>
      {unreachable ? t("hub.account.sidebar.hubUnavailable") : t("hub.account.sidebar.signIn")}
    </Text>
  );
}

const styles = StyleSheet.create((theme) => ({
  signInLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  unavailable: { color: theme.colors.statusWarning },
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
