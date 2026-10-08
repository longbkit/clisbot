import { useCallback } from "react";
import { usePathname, useRouter } from "expo-router";
import { Workflow } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { SidebarHeaderRow } from "@/components/sidebar/sidebar-header-row";
import { useHubAccount } from "./account-provider";

export function AutomationSidebarItem({ onBeforeNavigate }: { onBeforeNavigate?: () => void }) {
  const { t } = useTranslation();
  const hub = useHubAccount();
  const router = useRouter();
  const pathname = usePathname();
  const open = useCallback(() => {
    onBeforeNavigate?.();
    router.push("/automations");
  }, [onBeforeNavigate, router]);
  if (!hub.enabled || !hub.signedIn) return null;
  return (
    <SidebarHeaderRow
      icon={Workflow}
      label={t("hub.automations.title")}
      onPress={open}
      isActive={pathname === "/automations"}
      testID="sidebar-automations"
      variant="compact"
    />
  );
}
