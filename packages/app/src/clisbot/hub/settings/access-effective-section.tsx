import { Text, View } from "react-native";
import { Alert } from "@/components/ui/alert";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { constraintSummary, privilegeLabel, resourceKindLabel } from "./access-catalog";
import type { EffectiveAccess } from "./access-grantor";
import { EmptyRow } from "./access-settings-feedback";

/** What a Member who manages no one sees on Access: their own effective grants. */
export function MemberAccessSettings({ access }: { access: EffectiveAccess | undefined }) {
  return (
    <View>
      <SettingsSection title="Access overview">
        <Alert
          variant="info"
          title="Access is managed by your organization"
          description="Ask an owner or administrator to change Team or resource access."
        />
      </SettingsSection>
      {access ? <EffectiveAccessSection access={access} /> : null}
    </View>
  );
}

function EffectiveAccessSection({ access }: { access: EffectiveAccess }) {
  if (access.owner) {
    return (
      <SettingsSection title="Effective access">
        <Alert
          variant="info"
          title="Owner access is automatic"
          description="You can use every current and future Hub resource."
        />
      </SettingsSection>
    );
  }
  return (
    <SettingsSection title="Effective access">
      <View style={settingsStyles.card}>
        {access.grants.length === 0 ? (
          <EmptyRow message="No resource access has been granted yet." />
        ) : (
          access.grants.map((grant, index) => (
            <EffectiveAccessRow
              key={`${grant.assignmentId}:${grant.source.kind}`}
              grant={grant}
              bordered={index > 0}
            />
          ))
        )}
      </View>
    </SettingsSection>
  );
}

function EffectiveAccessRow({
  grant,
  bordered,
}: {
  grant: EffectiveAccess["grants"][number];
  bordered: boolean;
}) {
  const details = [
    resourceKindLabel(grant.resource.kind),
    grant.source.kind === "team" ? `Via ${grant.source.teamName}` : "Direct access",
    grant.resource.available ? null : "Unavailable",
  ].filter((value): value is string => value !== null);
  const constraint = constraintSummary(grant.constraints);
  return (
    <View style={[settingsStyles.row, bordered ? settingsStyles.rowBorder : null]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{grant.resource.name}</Text>
        <Text style={settingsStyles.rowHint}>{details.join(" · ")}</Text>
        <Text style={settingsStyles.rowHint}>
          {grant.privileges.length > 0
            ? grant.privileges.map(privilegeLabel).join(", ")
            : "No privileges"}
          {constraint === null ? "" : ` · ${constraint}`}
        </Text>
      </View>
    </View>
  );
}
