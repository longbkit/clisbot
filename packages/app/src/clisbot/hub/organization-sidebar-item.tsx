import { useCallback } from "react";
import { usePathname, useRouter } from "expo-router";
import { Building2 } from "lucide-react-native";
import { SidebarHeaderRow } from "@/components/sidebar/sidebar-header-row";
import { useHubAccount } from "./account-provider";
import { buildHubSettingsRoute } from "./navigation";

/** The active Hub organization at the top of the sidebar, like a workspace switcher: every Hub
 * surface below it (Automations, Hosts, Channels) acts in this organization. */
export function OrganizationSidebarItem({ onBeforeNavigate }: { onBeforeNavigate?: () => void }) {
  const hub = useHubAccount();
  const router = useRouter();
  const pathname = usePathname();
  const accountRoute = buildHubSettingsRoute("account");
  const open = useCallback(() => {
    onBeforeNavigate?.();
    router.push(accountRoute);
  }, [accountRoute, onBeforeNavigate, router]);
  const organization = hub.signedIn?.organization;
  if (!hub.enabled || organization === undefined) return null;
  return (
    <SidebarHeaderRow
      icon={Building2}
      label={organization.name}
      accessibilityLabel={`Hub organization: ${organization.name}`}
      onPress={open}
      isActive={pathname === accountRoute}
      testID="sidebar-hub-organization"
      variant="compact"
    />
  );
}
