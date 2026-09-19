import { useCallback, useMemo, useState } from "react";
import { View } from "react-native";
import { ArrowLeft } from "lucide-react-native";
import { useIsCompactFormFactor } from "@/constants/layout";
import { StyleSheet } from "react-native-unistyles";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { useHubAccount } from "../account-provider";
import { createChannelConnection } from "../channel-api";
import type { ChannelConnectionProblem } from "../channel-connection-form";
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

/**
 * Channels → Channel Integrations: every channel this Hub can run, as master and
 * detail. Two columns on a wide screen, the first channel open; on a phone the
 * list, then the chosen channel on its own screen with a way back.
 */
export function ChannelCatalogView() {
  const { rows, catalog, refresh, fetching, statusError } = useChannelCatalogQueries();
  const compact = useIsCompactFormFactor();
  const [chosenChannel, setSelectedChannel] = useState<string | null>(null);
  const selectedChannel = chosenChannel ?? (compact ? null : (rows[0]?.channel ?? null));
  const [connecting, setConnecting] = useState(false);
  const selected = rows.find((row) => row.channel === selectedChannel) ?? null;
  const select = useCallback((channel: string) => {
    setConnecting(false);
    setSelectedChannel(channel);
  }, []);
  const cancel = useCallback(() => setConnecting(false), []);
  const back = useCallback(() => setSelectedChannel(null), []);
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
  const list = (
    <SettingsSection title="Channels" trailing={refreshAction}>
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
  );
  const detail =
    selected === null ? null : (
      <ChannelSelection
        row={selected}
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
        <View style={styles.back}>
          <Button
            size="sm"
            variant="ghost"
            leftIcon={ArrowLeft}
            onPress={back}
            accessibilityLabel="Back to Channel Integrations"
          >
            Channel Integrations
          </Button>
        </View>
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
  return (
    <View style={styles.view}>
      <ChannelCatalogDetail row={row} onConnect={connecting ? undefined : onConnect} />
      {entry !== undefined && connecting && row.connectable ? (
        <ChannelConnectionSetup key={row.channel} entry={entry} save={save} onCancel={onCancel} />
      ) : null}
      {entry?.auth === "qr" ? (
        <ChannelQrPanel channel={row.channel} accountId={account?.accountId ?? row.channel} />
      ) : null}
      {entry === undefined ? null : <ChannelSupportSection entry={entry} />}
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
  back: { alignItems: "flex-start" },
  columns: { flexDirection: "row", alignItems: "flex-start", gap: theme.spacing[6] },
  master: { flexBasis: 320, flexShrink: 0 },
  detail: { flex: 1, minWidth: 0, gap: theme.spacing[2] },
}));
