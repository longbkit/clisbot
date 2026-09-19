import { useMemo } from "react";
import { View } from "react-native";
import { Alert } from "@/components/ui/alert";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import type { EffectiveAccess } from "./access-grantor";
import { effectiveGrantRows, groupGrantRows } from "./access-grant-rows";
import { AccessGrantsTable } from "./access-grants-table";

const NO_DIRECTORY = { members: [], teams: [], resources: [] };

/**
 * What a Member who manages no one sees on Access: their own effective access,
 * in the same list everyone else reads, without actions.
 */
export function MemberAccessSettings({ access }: { access: EffectiveAccess | undefined }) {
  const groups = useMemo(
    () =>
      access === undefined || access.owner
        ? []
        : groupGrantRows(
            effectiveGrantRows(
              access.grants,
              access.grants.map(({ resource }) => resource),
              access.accessLevels,
            ),
            "subject",
            "",
            NO_DIRECTORY,
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
            groups={groups}
            grouping="subject"
            groupHeaders={false}
            empty="No resource access has been granted to you yet."
          />
        )}
      </SettingsSection>
    </View>
  );
}
