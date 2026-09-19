import { useMemo } from "react";
import { Text, View } from "react-native";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Button } from "@/components/ui/button";
import { settingsStyles } from "@/styles/settings";
import { useHubAccount } from "../account-provider";
import {
  useChannelIdentityDirectory,
  type LinkedChannelIdentity,
} from "../channel-identity-directory";

const INFO =
  "Link the accounts you use in Slack, Telegram, Discord, and other chat apps so the organization's bots recognize you and run your messages with your Hub access.";

/** Account's view of the Member's own linked chat accounts, and the entry to linking more. */
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
  const manage = useMemo(
    () => (
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onPress={onManage}
        accessibilityLabel="Manage chat accounts"
      >
        Manage
      </Button>
    ),
    [onManage, pending],
  );
  return (
    <SettingsSection title="Chat accounts" info={INFO} trailing={manage}>
      <View style={settingsStyles.card}>
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
      <View style={settingsStyles.row}>
        <Text style={settingsStyles.rowHint}>
          {error?.message ?? "No chat accounts are linked yet."}
        </Text>
      </View>
    );
  }
  // Where you chat reads first; the account id on that platform is the detail under it.
  return identities.map((identity, index) => (
    <View
      key={identity.id}
      style={[settingsStyles.row, index > 0 ? settingsStyles.rowBorder : null]}
    >
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{identity.description}</Text>
        <Text style={settingsStyles.rowHint}>{`Account ${identity.subject}`}</Text>
      </View>
    </View>
  ));
}
