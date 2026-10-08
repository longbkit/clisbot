import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { ConnectorMcpServer } from "@clisbot/protocol/connectors/types";
import { SettingsSection } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { settingsStyles } from "@/styles/settings";
import { ComposioKeyRow } from "./composio-key-row";
import { ComposioSetup } from "./composio-setup";
import { ConnectorAppDetail } from "./connector-app-detail";
import { ConnectorsBrowse } from "./connectors-browse";
import { McpServerDetail } from "./mcp-server-detail";
import { appState } from "./model";
import type { useConnectorsScreen } from "./use-connectors-screen";

type Screen = ReturnType<typeof useConnectorsScreen>;

/**
 * The detail column: the chosen server or app, the Composio setup when the Host has no key,
 * or, on a wide screen with nothing chosen, the app cards.
 */
export function ConnectorsDetail({
  serverId,
  screen,
  compact,
  onAddServer,
  onEditServer,
}: {
  serverId: string;
  screen: Screen;
  compact: boolean;
  onAddServer(): void;
  onEditServer(server: ConnectorMcpServer): void;
}) {
  if (screen.selectedServer) {
    return (
      <ServerDetail
        serverId={serverId}
        server={screen.selectedServer}
        screen={screen}
        onEditServer={onEditServer}
      />
    );
  }
  if (!screen.settings.data) return null;
  if (!screen.configured && (screen.selection !== null || !compact)) {
    return (
      <SetupDetail
        serverId={serverId}
        appName={screen.selectedItem?.name}
        onAddServer={onAddServer}
      />
    );
  }
  if (screen.selectedItem) {
    return (
      <ConnectorAppDetail
        // One page per app: a sign-in started for one app never shows on another's.
        key={`${serverId}:${screen.selectedItem.slug}`}
        serverId={serverId}
        item={screen.selectedItem}
        app={screen.accountMap.get(screen.selectedItem.slug)}
        accountsError={screen.accounts.data === undefined ? screen.accounts.error : null}
        uses={screen.uses}
      />
    );
  }
  return compact ? null : (
    <BrowseDetail serverId={serverId} screen={screen} onAddServer={onAddServer} />
  );
}

function ServerDetail({
  serverId,
  server,
  screen,
  onEditServer,
}: {
  serverId: string;
  server: ConnectorMcpServer;
  screen: Screen;
  onEditServer(server: ConnectorMcpServer): void;
}) {
  const edit = useCallback(() => onEditServer(server), [onEditServer, server]);
  const { setSelectedKey } = screen;
  const removed = useCallback(() => setSelectedKey(null), [setSelectedKey]);
  return (
    <McpServerDetail
      serverId={serverId}
      server={server}
      uses={screen.uses}
      onEdit={edit}
      onRemoved={removed}
    />
  );
}

function BrowseDetail({
  serverId,
  screen,
  onAddServer,
}: {
  serverId: string;
  screen: Screen;
  onAddServer(): void;
}) {
  const { lists, accountMap, setSelectedKey } = screen;
  const connected = useMemo(
    () =>
      lists.connected.map((item) => ({
        item,
        state: appState(accountMap.get(item.slug)?.accounts),
      })),
    [lists.connected, accountMap],
  );
  const popular = useMemo(
    () => lists.others.map((item) => ({ item, state: "none" as const })),
    [lists.others],
  );
  const select = useCallback((slug: string) => setSelectedKey(`app:${slug}`), [setSelectedKey]);
  const selectServer = useCallback(
    (name: string) => setSelectedKey(`mcp:${name}`),
    [setSelectedKey],
  );
  return (
    <View>
      <ComposioKeyRow serverId={serverId} keyHint={screen.settings.data?.composio.keyHint} />
      <ConnectorsBrowse
        connected={connected}
        popular={popular}
        servers={screen.settings.data?.mcpServers ?? []}
        onSelect={select}
        onSelectServer={selectServer}
        onAddServer={onAddServer}
      />
    </View>
  );
}

function SetupDetail({
  serverId,
  appName,
  onAddServer,
}: {
  serverId: string;
  appName?: string;
  onAddServer(): void;
}) {
  const { t } = useTranslation();
  return (
    <View>
      {appName ? (
        <Text style={[settingsStyles.rowHint, styles.lead]}>
          {t("connectors.screen.detail.connectFirst", { app: appName })}
        </Text>
      ) : null}
      <ComposioSetup serverId={serverId} />
      <SettingsSection
        title={t("connectors.screen.common.mcpServers")}
        info={t("connectors.screen.detail.serverInfo")}
      >
        <View style={settingsStyles.card}>
          <View style={settingsStyles.row}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>{t("connectors.screen.detail.keepLocal")}</Text>
              <Text style={settingsStyles.rowHint}>
                {t("connectors.screen.detail.keepLocalHint")}
              </Text>
            </View>
            <Button variant="outline" size="sm" onPress={onAddServer}>
              {t("connectors.screen.common.addMcpServer")}
            </Button>
          </View>
        </View>
      </SettingsSection>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  lead: { marginBottom: theme.spacing[4] },
}));
