import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { NotificationScope } from "@clisbot/protocol/notification-audience";
import { SettingsCard, SettingsSection, SettingsSelect } from "@/components/settings";
import { useAppSettings } from "@/hooks/use-settings";

const NOTIFICATION_SCOPES: readonly NotificationScope[] = ["mine", "needs", "others", "all", "off"];

function scopeLabelKey(scope: NotificationScope): string {
  if (scope === "off") return "notificationScope.off";
  if (scope === "needs") return "navigation.chips.needs";
  return `navigation.scope.${scope}`;
}

/** Which sessions notify this device, with the same choices as the Home scope tabs. */
export function NotificationsSection() {
  const { t } = useTranslation();
  const { settings, updateSettings } = useAppSettings();
  const options = useMemo(
    () =>
      NOTIFICATION_SCOPES.map((value) => ({
        value,
        label: t(scopeLabelKey(value)),
      })),
    [t],
  );
  const change = useCallback(
    (notificationScope: NotificationScope) => void updateSettings({ notificationScope }),
    [updateSettings],
  );
  return (
    <SettingsSection title={t("notificationScope.title")}>
      <SettingsCard>
        <SettingsSelect
          label={t("notificationScope.label")}
          hint={`${t(`notificationScope.descriptions.${settings.notificationScope}`)} ${t("notificationScope.hostNote")}`}
          value={settings.notificationScope}
          options={options}
          onValueChange={change}
        />
      </SettingsCard>
    </SettingsSection>
  );
}
