import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { i18n } from "@/i18n/i18next";
import { settingsStyles } from "@/styles/settings";
import { isSupportedTransport, type ChannelCatalogEntry } from "../channel-catalog";
import {
  channelSeverityVariant,
  type ChannelAccountHealth,
  type ChannelCatalogRow,
} from "../channel-account-health";

/**
 * The selected channel: what it needs, how it connects, and the health of every
 * account configured for it.
 */
export function ChannelCatalogDetail({
  row,
  onConnect,
}: {
  row: ChannelCatalogRow;
  onConnect?: (() => void) | undefined;
}) {
  const { t } = useTranslation();
  return (
    <SettingsSection title={row.label}>
      {row.entry === undefined ? (
        <Alert
          variant="info"
          title={t("hub.channels.catalogDetail.notInCatalogTitle")}
          description={t("hub.channels.catalogDetail.notInCatalogBody")}
        />
      ) : null}
      {row.status === "planned" ? (
        <Alert
          variant="info"
          title={t("hub.channels.catalogDetail.comingSoon")}
          description={t("hub.channels.catalogDetail.plannedBody", { label: row.label })}
        />
      ) : null}
      <ChannelAccountHealthCard accounts={row.accounts} />
      {onConnect === undefined || !row.connectable ? null : (
        <View style={styles.actions}>
          <Button size="sm" onPress={onConnect}>
            {t("hub.channels.catalogDetail.connect", { label: row.label })}
          </Button>
        </View>
      )}
      {row.entry === undefined ? null : <ChannelConnectGuide entry={row.entry} />}
    </SettingsSection>
  );
}

/** How a Connection of this channel is made, and what to know first. */
function ChannelConnectGuide({ entry }: { entry: ChannelCatalogEntry }) {
  const { t } = useTranslation();
  const labels = new Map(entry.credentials.map(({ key, label }) => [key, label]));
  return (
    <>
      <Text style={styles.heading}>{t("hub.channels.catalogDetail.howItConnects")}</Text>
      <View style={settingsStyles.card}>
        {entry.transports.map((transport, index) => (
          <View
            key={transport.id}
            style={[settingsStyles.row, index > 0 ? settingsStyles.rowBorder : null]}
          >
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>{transport.label}</Text>
              <Text style={settingsStyles.rowHint}>{transport.setup}</Text>
              <Text style={settingsStyles.rowHint}>
                {t("hub.channels.catalogDetail.needs", {
                  items: transport.requiredConfig.map((key) => labels.get(key) ?? key).join(", "),
                })}
              </Text>
            </View>
            {isSupportedTransport(transport) ? null : (
              // Ported but not yet run end to end, so a Connection cannot pick it.
              <StatusBadge
                label={t("hub.channels.catalogDetail.notSupportedYet")}
                variant="muted"
              />
            )}
          </View>
        ))}
      </View>
      {entry.notes.length === 0 ? null : (
        <>
          <Text style={styles.heading}>{t("hub.channels.catalogDetail.beforeYouConnect")}</Text>
          {entry.notes.map((note) => (
            <Text key={note} style={settingsStyles.rowHint}>
              {note}
            </Text>
          ))}
        </>
      )}
    </>
  );
}

function ChannelAccountHealthCard({ accounts }: { accounts: readonly ChannelAccountHealth[] }) {
  const { t } = useTranslation();
  if (accounts.length === 0) {
    return (
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <Text style={settingsStyles.rowHint}>{t("hub.channels.catalogDetail.noConnection")}</Text>
        </View>
      </View>
    );
  }
  return (
    <View style={settingsStyles.card}>
      {accounts.map((account, index) => (
        <ChannelAccountHealthRow key={account.key} account={account} bordered={index > 0} />
      ))}
    </View>
  );
}

function ChannelAccountHealthRow({
  account,
  bordered,
}: {
  account: ChannelAccountHealth;
  bordered: boolean;
}) {
  const { t } = useTranslation();
  return (
    <View style={[settingsStyles.row, bordered ? settingsStyles.rowBorder : null]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{account.accountId}</Text>
        <Text style={settingsStyles.rowHint}>{identityLine(account)}</Text>
        <Text style={settingsStyles.rowHint}>{queueLine(account)}</Text>
        {account.detail === null ? null : (
          <Text style={settingsStyles.rowError}>{account.detail}</Text>
        )}
      </View>
      <StatusBadge
        label={account.enabled ? account.transportLabel : t("hub.channels.transport.disabled")}
        variant={channelSeverityVariant(account.severity)}
      />
    </View>
  );
}

function identityLine(account: ChannelAccountHealth): string {
  if (account.connectionName !== null) {
    return account.identity === null
      ? account.connectionName
      : `${account.identity} · ${account.connectionName}`;
  }
  if (account.connectionId === null) return i18n.t("hub.channels.catalogDetail.noReference");
  return i18n.t("hub.channels.catalogDetail.referenceUnavailable");
}

function queueLine(account: ChannelAccountHealth): string {
  if (account.ingressSummary === null) return i18n.t("hub.channels.catalogDetail.noQueueDepth");
  return account.oldestPending === null
    ? account.ingressSummary
    : i18n.t("hub.channels.catalogDetail.withOldest", {
        summary: account.ingressSummary,
        age: account.oldestPending,
      });
}

const styles = StyleSheet.create((theme) => ({
  actions: {
    flexDirection: "row",
    gap: theme.spacing[2],
  },
  heading: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    marginTop: theme.spacing[2],
  },
}));
