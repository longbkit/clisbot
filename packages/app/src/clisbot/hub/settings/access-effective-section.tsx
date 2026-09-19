import { useMemo } from "react";
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
        title="Your access"
        info="Your own grants and your Teams'. Ask an Organization Admin, or whoever shares a resource, to change them."
      >
        {access?.owner ? (
          <Alert
            variant="info"
            title="Owner access is automatic"
            description="You can use every current and future Hub resource."
          />
        ) : (
          <AccessGrantsTable
            rows={rows}
            grouping="subject"
            empty="No resource access has been granted to you yet."
          />
        )}
      </SettingsSection>
    </View>
  );
}
