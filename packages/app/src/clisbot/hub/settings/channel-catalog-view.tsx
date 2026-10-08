import { RefreshCw } from "lucide-react-native";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { useIsCompactFormFactor } from "@/constants/layout";
import { StyleSheet } from "react-native-unistyles";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { i18n } from "@/i18n/i18next";
import { useHubAccount } from "../account-provider";
import { createChannelConnection } from "../channel-api";
import { addQrChannelAccount } from "../channel-qr-account";
import { connectionNamesFor, type ChannelConnectionProblem } from "../channel-connection-form";
import type { ChannelCatalogRow } from "../channel-account-health";
import type { ChannelCatalogEntry } from "../channel-catalog";
import { useChannelConnectionSave } from "./channel-connection-add";
import { ChannelSupportSection } from "./channel-support-section";
import { ChannelCatalogDetail } from "./channel-catalog-detail";
import { ChannelCatalogList } from "./channel-catalog-list";
import { useChannelCatalogQueries } from "./channel-catalog-queries";
import { ChannelConnectionSetup } from "./channel-connection-setup";
import { ChannelQrLinkPanel } from "./channel-qr-link-panel";
import { CHANNEL_QR_OPERATIONS_AVAILABLE, useChannelQrVerbs } from "./channel-qr-verbs";
import { BackLink } from "./back-link";

/**
 * Channels → Channel Integrations: every channel this Hub can run, as master and
 * detail. Two columns on a wide screen, the first channel open; on a phone the
 * list, then the chosen channel on its own screen with a way back.
 */
export function ChannelCatalogView() {
  const { t } = useTranslation();
  const { rows, connections, catalog, refresh, fetching, statusError } = useChannelCatalogQueries();
  const compact = useIsCompactFormFactor();
  const [chosenChannel, setSelectedChannel] = useState<string | null>(null);
  const selectedChannel = chosenChannel ?? (compact ? null : (rows[0]?.channel ?? null));
  const [connecting, setConnecting] = useState(false);
  const selected = rows.find((row) => row.channel === selectedChannel) ?? null;
  // The account a QR Connection just added here: its code shows without a click,
  // once — leaving the channel forgets it, so coming back does not log in again.
  const [justConnected, setJustConnected] = useState<string | null>(null);
  const select = useCallback((channel: string) => {
    setConnecting(false);
    setJustConnected(null);
    setSelectedChannel(channel);
  }, []);
  const cancel = useCallback(() => setConnecting(false), []);
  const back = useCallback(() => {
    setJustConnected(null);
    setSelectedChannel(null);
  }, []);
  const connect = useCallback(() => setConnecting(true), []);
  const save = useSaveConnection(selected?.entry, refresh, cancel, setJustConnected);
  // Both columns open on a text label, so their cards start level; a button in
  // this header would make it taller than the detail's.
  const list = (
    <SettingsSection title={t("hub.channels.catalogView.allChannels")}>
      {catalog.availability === "available" || catalog.message === null ? null : (
        <Alert
          variant={catalog.availability === "loading" ? "info" : "warning"}
          title={catalogStateTitle(catalog.availability)}
          description={catalog.message}
        />
      )}
      {statusError === null ? null : (
        <Alert
          variant="warning"
          title={t("hub.channels.catalogView.statusUnavailable")}
          description={statusError.message}
        />
      )}
      <ChannelCatalogList rows={rows} selected={selectedChannel} onSelect={select} />
      <View style={styles.refresh}>
        <Button
          size="sm"
          variant="ghost"
          leftIcon={RefreshCw}
          loading={fetching}
          disabled={fetching}
          onPress={refresh}
        >
          {t("hub.channels.catalogView.refreshHealth")}
        </Button>
      </View>
    </SettingsSection>
  );
  const detail =
    selected === null ? null : (
      <ChannelSelection
        row={selected}
        takenNames={connectionNamesFor(selected.channel, connections)}
        justConnected={justConnected}
        connecting={connecting}
        onConnect={connect}
        onCancel={cancel}
        save={save}
      />
    );
  if (compact)
    return selected === null ? (
      list
    ) : (
      <View style={styles.view}>
        <BackLink to={t("hub.channels.catalogView.backTo")} onPress={back} />
        {detail}
      </View>
    );
  return (
    <View style={styles.columns}>
      <View style={styles.master}>{list}</View>
      <View style={styles.detail}>{detail}</View>
    </View>
  );
}

function catalogStateTitle(availability: string): string | undefined {
  if (availability === "loading") return i18n.t("hub.channels.catalogView.loading");
  if (availability === "unavailable") return i18n.t("hub.channels.catalogView.unavailable");
  if (availability === "error") return i18n.t("hub.channels.catalogView.error");
  return undefined;
}

function ChannelSelection({
  row,
  takenNames,
  justConnected,
  connecting,
  onConnect,
  onCancel,
  save,
}: {
  row: ChannelCatalogRow;
  takenNames: readonly string[];
  /** The account whose Connection was just added here: its login code shows without a click. */
  justConnected: string | null;
  connecting: boolean;
  onConnect(): void;
  onCancel(): void;
  save(body: Record<string, unknown>): Promise<ChannelConnectionProblem | null>;
}) {
  // The just-added account, when there is one: a channel can hold several.
  const account =
    row.accounts.find((candidate) => candidate.accountId === justConnected) ??
    row.accounts[0] ??
    null;
  const entry = row.entry;
  return (
    <View style={styles.view}>
      <ChannelCatalogDetail row={row} onConnect={connecting ? undefined : onConnect} />
      {entry !== undefined && connecting && row.connectable ? (
        <ChannelConnectionSetup
          key={row.channel}
          entry={entry}
          takenNames={takenNames}
          save={save}
          onCancel={onCancel}
        />
      ) : null}
      {/* QR login runs on a real account; before one exists, Connect creates it. */}
      {entry?.auth === "qr" && account !== null ? (
        <ChannelQrPanel
          key={account.accountId}
          channel={row.channel}
          accountId={account.accountId}
          autoStart={account.accountId === justConnected}
        />
      ) : null}
      {entry === undefined ? null : <ChannelSupportSection entry={entry} />}
    </View>
  );
}

function ChannelQrPanel({
  channel,
  accountId,
  autoStart,
}: {
  channel: string;
  accountId: string;
  autoStart: boolean;
}) {
  const verbs = useChannelQrVerbs({ channel, accountId });
  return (
    <ChannelQrLinkPanel
      channel={channel}
      available={CHANNEL_QR_OPERATIONS_AVAILABLE}
      verbs={verbs}
      framed
      autoStart={autoStart}
    />
  );
}

function useSaveConnection(
  entry: ChannelCatalogEntry | undefined,
  refresh: () => void,
  close: () => void,
  /** The account a QR Connection was added with, for its login to start at once. */
  qrAccountAdded: (accountId: string) => void,
): (body: Record<string, unknown>) => Promise<ChannelConnectionProblem | null> {
  const hub = useHubAccount();
  const create = useCallback(
    async (body: Record<string, unknown>) => {
      const created = await createChannelConnection(hub.api(), body);
      // A QR channel's login runs on its account, so the account comes now and
      // the QR code shows here; its Routes come after.
      if (entry?.auth !== "qr") return;
      await addQrChannelAccount(hub.api(), created);
      qrAccountAdded(created.name);
    },
    [entry?.auth, hub, qrAccountAdded],
  );
  const save = useChannelConnectionSave(entry, create);
  return useCallback(
    async (body) => {
      const problem = await save(body);
      if (problem !== null) return problem;
      refresh();
      close();
      return null;
    },
    [close, refresh, save],
  );
}

const styles = StyleSheet.create((theme) => ({
  view: {
    gap: theme.spacing[2],
  },
  columns: { flexDirection: "row", alignItems: "flex-start", gap: theme.spacing[6] },
  master: { flexBasis: 320, flexShrink: 0 },
  detail: { flex: 1, minWidth: 0, gap: theme.spacing[2] },
  // The ghost button's padding moves out, so its icon sits on the section label's rail.
  refresh: { alignItems: "flex-start", marginLeft: theme.spacing[1] - (theme.spacing[3] + 1) },
}));
