import { useCallback, useMemo, useState } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SettingsSection } from "@/screens/settings/settings-section";
import { useHubAccount } from "../account-provider";
import { createChannelConnection } from "../channel-api";
import type { ChannelConnectionProblem } from "../channel-connection-form";
import type { ChannelCatalogRow } from "../channel-account-health";
import type { ChannelCatalogEntry } from "../channel-catalog";
import { useChannelConnectionSave } from "./channel-connection-add";
import { ChannelCapabilityMatrix } from "./channel-capability-matrix";
import { ChannelCatalogDetail } from "./channel-catalog-detail";
import { ChannelCatalogList } from "./channel-catalog-list";
import { useChannelCatalogQueries } from "./channel-catalog-queries";
import { ChannelConnectionSetup } from "./channel-connection-setup";
import { ChannelQrLinkPanel } from "./channel-qr-link-panel";
import { CHANNEL_QR_OPERATIONS_AVAILABLE, useChannelQrVerbs } from "./channel-qr-verbs";

/**
 * Channels → Catalog: every channel this build knows, its prerequisites, the
 * health of its accounts, its capability matrix, and the setup flow for the ones
 * this Hub can connect.
 */
export function ChannelCatalogView() {
  const { rows, catalog, refresh, fetching, statusError } = useChannelCatalogQueries();
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const selected = rows.find((row) => row.channel === selectedChannel) ?? null;
  const select = useCallback((channel: string) => {
    setConnecting(false);
    setSelectedChannel(channel);
  }, []);
  const cancel = useCallback(() => setConnecting(false), []);
  const connect = useCallback(() => setConnecting(true), []);
  const save = useSaveConnection(selected?.entry, refresh, cancel);
  const refreshAction = useMemo(
    () => (
      <Button size="sm" variant="ghost" loading={fetching} disabled={fetching} onPress={refresh}>
        Refresh health
      </Button>
    ),
    [fetching, refresh],
  );
  return (
    <View style={styles.view}>
      <SettingsSection title="Channel catalog" trailing={refreshAction}>
        {catalog.availability === "available" || catalog.message === null ? null : (
          <Alert
            variant={catalog.availability === "loading" ? "info" : "warning"}
            title={CATALOG_STATE_TITLES[catalog.availability]}
            description={catalog.message}
          />
        )}
        {statusError === null ? null : (
          <Alert
            variant="warning"
            title="Channel runtime status is unavailable"
            description={statusError.message}
          />
        )}
        <ChannelCatalogList rows={rows} selected={selectedChannel} onSelect={select} />
      </SettingsSection>
      {selected === null ? null : (
        <ChannelSelection
          row={selected}
          connecting={connecting}
          onConnect={connect}
          onCancel={cancel}
          save={save}
        />
      )}
    </View>
  );
}

const CATALOG_STATE_TITLES: Readonly<Record<string, string>> = {
  loading: "Loading channels",
  unavailable: "Catalog not available on this Hub",
  error: "The channel catalog could not be read",
};

function ChannelSelection({
  row,
  connecting,
  onConnect,
  onCancel,
  save,
}: {
  row: ChannelCatalogRow;
  connecting: boolean;
  onConnect(): void;
  onCancel(): void;
  save(body: Record<string, unknown>): Promise<ChannelConnectionProblem | null>;
}) {
  const account = row.accounts[0] ?? null;
  const entry = row.entry;
  const capabilityAccount = useMemo(
    () =>
      account === null
        ? null
        : {
            transport: account.transport,
            enabled: account.enabled,
            detail: account.detail ?? undefined,
          },
    [account],
  );
  return (
    <View style={styles.view}>
      <ChannelCatalogDetail row={row} onConnect={connecting ? undefined : onConnect} />
      {entry !== undefined && connecting && row.connectable ? (
        <ChannelConnectionSetup key={row.channel} entry={entry} save={save} onCancel={onCancel} />
      ) : null}
      {entry?.auth === "qr" ? (
        <ChannelQrPanel channel={row.channel} accountId={account?.accountId ?? row.channel} />
      ) : null}
      {entry === undefined ? null : (
        <ChannelCapabilityMatrix entry={entry} account={capabilityAccount} />
      )}
    </View>
  );
}

function ChannelQrPanel({ channel, accountId }: { channel: string; accountId: string }) {
  const verbs = useChannelQrVerbs({ channel, accountId });
  return (
    <ChannelQrLinkPanel
      accountId={accountId}
      available={CHANNEL_QR_OPERATIONS_AVAILABLE}
      verbs={verbs}
    />
  );
}

function useSaveConnection(
  entry: ChannelCatalogEntry | undefined,
  refresh: () => void,
  close: () => void,
): (body: Record<string, unknown>) => Promise<ChannelConnectionProblem | null> {
  const hub = useHubAccount();
  const create = useCallback(
    async (body: Record<string, unknown>) => {
      await createChannelConnection(hub.api(), body);
    },
    [hub],
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
}));
