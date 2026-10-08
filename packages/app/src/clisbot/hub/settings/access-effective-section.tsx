import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { Alert } from "@/components/ui/alert";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import type { EffectiveAccess } from "./access-grantor";
import { effectiveGrantRows, sortGrantRows } from "./access-grant-rows";
import { AccessGrantsTable } from "./access-grants-table";

/**
 * What a Member who manages no one sees on Access: their own effective access,
 * in the same list everyone else reads, without actions.
 */
export function MemberAccessSettings({ access }: { access: EffectiveAccess | undefined }) {
  const { t } = useTranslation();
  const rows = useMemo(
    () =>
      access === undefined || access.owner
        ? []
        : sortGrantRows(
            effectiveGrantRows(
              access.grants,
              access.grants.map(({ resource }) => resource),
              access.accessLevels,
            ),
            "subject",
          ),
    [access],
  );
  return (
    <View>
      <SettingsSection
        title={t("hub.access.yourAccess.title")}
        info={t("hub.access.yourAccess.info")}
      >
        {access?.owner ? (
          <Alert
            variant="info"
            title={t("hub.access.yourAccess.ownerTitle")}
            description={t("hub.access.yourAccess.ownerDescription")}
          />
        ) : (
          <AccessGrantsTable
            rows={rows}
            grouping="subject"
            empty={t("hub.access.yourAccess.empty")}
          />
        )}
      </SettingsSection>
    </View>
  );
}
