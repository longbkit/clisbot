import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Button } from "@/components/ui/button";
import { settingsStyles } from "@/styles/settings";
import { useHubAccount } from "../account-provider";
import {
  useChannelIdentityDirectory,
  type LinkedChannelIdentity,
} from "../channel-identity-directory";

/** Account's view of the Member's own linked chat accounts, and the entry to linking more. */
export function ChannelIdentitiesSection({
  pending,
  onManage,
}: {
  pending: boolean;
  onManage(): void;
}) {
  const { t } = useTranslation();
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
        accessibilityLabel={t("hub.channels.identities.manageLabel")}
      >
        {t("hub.channels.identities.manage")}
      </Button>
    ),
    [onManage, pending, t],
  );
  return (
    <SettingsSection
      title={t("hub.channels.identities.title")}
      info={t("hub.channels.identities.info")}
      trailing={manage}
    >
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
  const { t } = useTranslation();
  if (error !== null || (identities.length === 0 && !pending)) {
    return (
      <View style={settingsStyles.row}>
        <Text style={settingsStyles.rowHint}>
          {error?.message ?? t("hub.channels.identities.empty")}
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
        <Text style={settingsStyles.rowHint}>
          {t("hub.channels.identities.account", { subject: identity.subject })}
        </Text>
      </View>
    </View>
  ));
}
