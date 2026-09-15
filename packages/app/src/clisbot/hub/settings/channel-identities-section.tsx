import { Text, View } from "react-native";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Button } from "@/components/ui/button";
import { settingsStyles } from "@/styles/settings";

/** Account's entry to linking the Member's own Slack or Telegram accounts. */
export function ChannelIdentitiesSection({
  pending,
  onManage,
}: {
  pending: boolean;
  onManage(): void;
}) {
  return (
    <SettingsSection title="Channel identities">
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>Your Channel identities</Text>
            <Text style={settingsStyles.rowHint}>
              Link your Slack or Telegram account so messages you send there run with your Hub
              access.
            </Text>
          </View>
          <Button size="sm" variant="outline" disabled={pending} onPress={onManage}>
            Manage identities
          </Button>
        </View>
      </View>
    </SettingsSection>
  );
}
