import { Text, View } from "react-native";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Button } from "@/components/ui/button";
import { settingsStyles } from "@/styles/settings";
import { useHubAccount } from "../account-provider";
import {
  useChannelIdentityDirectory,
  type LinkedChannelIdentity,
} from "../channel-identity-directory";

/** Account's view of the Member's own linked Slack or Telegram identities, and the entry to linking more. */
export function ChannelIdentitiesSection({
  pending,
  onManage,
}: {
  pending: boolean;
  onManage(): void;
}) {
  const hub = useHubAccount();
  const directory = useChannelIdentityDirectory();
  const identities = directory.identitiesOf(hub.signedIn?.membership.id);
  return (
    <SettingsSection title="Channel identities">
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>Your Channel identities</Text>
            <Text style={settingsStyles.rowHint}>
              Link the accounts you use in Slack, Telegram, Discord, and other chat apps so the
              organization&apos;s bots recognize you and run your messages with your Hub access.
            </Text>
          </View>
          <Button size="sm" variant="outline" disabled={pending} onPress={onManage}>
            Manage identities
          </Button>
        </View>
        <LinkedIdentityRows
          identities={identities}
          pending={directory.pending}
          error={directory.error}
        />
      </View>
    </SettingsSection>
  );
}

function LinkedIdentityRows({
  identities,
  pending,
  error,
}: {
  identities: LinkedChannelIdentity[];
  pending: boolean;
  error: Error | null;
}) {
  if (error !== null || (identities.length === 0 && !pending)) {
    return (
      <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
        <Text style={settingsStyles.rowHint}>
          {error?.message ?? "No chat accounts are linked yet."}
        </Text>
      </View>
    );
  }
  return identities.map((identity) => (
    <View key={identity.id} style={[settingsStyles.row, settingsStyles.rowBorder]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{identity.subject}</Text>
        <Text style={settingsStyles.rowHint}>{identity.description}</Text>
      </View>
    </View>
  ));
}
