import { useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { ConnectorMcpServer } from "@clisbot/protocol/connectors/types";
import { MenuHeader } from "@/components/headers/menu-header";
import { useIsCompactFormFactor } from "@/constants/layout";
import { settingsStyles } from "@/styles/settings";
import { BackLink } from "../hub/settings/back-link";
import { ConnectorsDetail } from "./connectors-detail";
import { ConnectorsMaster } from "./connectors-master";
import { useConnectorsFeatureHosts } from "./feature";
import { McpServerSheet } from "./mcp-server-sheet";
import { useConnectorsScreen } from "./use-connectors-screen";

/**
 * Connectors (docs/features/connectors/README.md): every app this Host can connect through
 * Composio and every MCP server added here, in the settings shell's list and detail
 * (design.md §9): two columns on a wide screen, the list then one item on a phone.
 */
export function ConnectorsScreen() {
  const hosts = useConnectorsFeatureHosts();
  // Bot and Project settings open this screen on their own Host.
  const params = useLocalSearchParams<{ serverId?: string }>();
  const [chosenHost, setChosenHost] = useState<string | null>(params.serverId ?? null);
  const serverId =
    hosts.find((host) => host.serverId === chosenHost)?.serverId ?? hosts[0]?.serverId ?? null;
  return (
    <View style={styles.page}>
      <MenuHeader title="Connectors" />
      {serverId === null ? (
        <View style={styles.empty}>
          <Text style={settingsStyles.rowHint}>
            No connected Host offers Connectors. Update the Host to use them.
          </Text>
        </View>
      ) : (
        <ConnectorsBody key={serverId} serverId={serverId} hosts={hosts} onHost={setChosenHost} />
      )}
    </View>
  );
}

type SheetState = { open: false } | { open: true; editing: ConnectorMcpServer | null };

function ConnectorsBody({
  serverId,
  hosts,
  onHost,
}: {
  serverId: string;
  hosts: { serverId: string; label: string }[];
  onHost(id: string): void;
}) {
  const compact = useIsCompactFormFactor();
  const screen = useConnectorsScreen(serverId);
  const sheet = useServerSheet(screen.showServer);
  const back = useCallback(() => screen.setSelectedKey(null), [screen]);
  const master = (
    <ConnectorsMaster
      compact={compact}
      serverId={serverId}
      hosts={hosts}
      onHost={onHost}
      screen={screen}
      onAddServer={sheet.openAdd}
    />
  );
  const detail = (
    <ConnectorsDetail
      serverId={serverId}
      screen={screen}
      compact={compact}
      onAddServer={sheet.openAdd}
      onEditServer={sheet.openEdit}
    />
  );
  const sheetView = (
    <McpServerSheet
      key={sheet.state.open ? (sheet.state.editing?.name ?? "new") : "closed"}
      serverId={serverId}
      visible={sheet.state.open}
      editing={sheet.state.open ? sheet.state.editing : null}
      onClose={sheet.close}
      onSaved={sheet.saved}
    />
  );
  if (compact) {
    return (
      <ScrollView contentContainerStyle={styles.compactContent}>
        {screen.selection === null ? master : <BackLink to="Connectors" onPress={back} />}
        {screen.selection === null ? null : detail}
        {sheetView}
      </ScrollView>
    );
  }
  return (
    <View style={styles.columns}>
      <ScrollView style={styles.masterScroll} contentContainerStyle={styles.masterContent}>
        {master}
      </ScrollView>
      <ScrollView style={styles.detailScroll} contentContainerStyle={styles.detailContent}>
        {detail}
      </ScrollView>
      {sheetView}
    </View>
  );
}

function useServerSheet(showServer: (name: string) => void) {
  const [state, setState] = useState<SheetState>({ open: false });
  const openAdd = useCallback(() => setState({ open: true, editing: null }), []);
  const openEdit = useCallback(
    (server: ConnectorMcpServer) => setState({ open: true, editing: server }),
    [],
  );
  const close = useCallback(() => setState({ open: false }), []);
  const saved = useCallback(
    (name: string) => {
      setState({ open: false });
      showServer(name);
    },
    [showServer],
  );
  return { state, openAdd, openEdit, close, saved };
}

const styles = StyleSheet.create((theme) => ({
  page: { flex: 1, backgroundColor: theme.colors.surface0 },
  empty: { padding: theme.spacing[6] },
  columns: { flex: 1, flexDirection: "row" },
  masterScroll: {
    width: 320,
    flexGrow: 0,
    flexShrink: 0,
    borderRightWidth: 1,
    borderRightColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceSidebar,
  },
  masterContent: { padding: theme.spacing[4] },
  detailScroll: { flex: 1 },
  detailContent: { padding: theme.spacing[6], maxWidth: 960 },
  compactContent: { padding: theme.spacing[4], gap: theme.spacing[3] },
}));
