import { Plus } from "lucide-react-native";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ComposioKeyRow } from "./composio-key-row";
import { ConnectorsHostPicker } from "./connectors-host-picker";
import { ConnectorsList } from "./connectors-list";
import type { useConnectorsScreen } from "./use-connectors-screen";

/** The list column: Host, search, filters, rows, then the way to add a server and the key. */
export function ConnectorsMaster({
  compact,
  serverId,
  hosts,
  onHost,
  screen,
  onAddServer,
}: {
  /** On a wide screen the key and the servers live in the overview beside the list. */
  compact: boolean;
  serverId: string;
  hosts: { serverId: string; label: string }[];
  onHost(id: string): void;
  screen: ReturnType<typeof useConnectorsScreen>;
  onAddServer(): void;
}) {
  return (
    <View style={styles.master}>
      {hosts.length > 1 ? (
        <ConnectorsHostPicker hosts={hosts} value={serverId} onChange={onHost} />
      ) : null}
      {screen.settings.error ? (
        <Alert
          variant="error"
          title="Connectors are unavailable"
          description={screen.settings.error.message}
        />
      ) : null}
      {screen.accounts.error ? (
        <Alert
          variant="warning"
          title="Connected accounts could not be read"
          description={
            screen.accounts.data
              ? `Showing the accounts read last. ${screen.accounts.error.message}`
              : screen.accounts.error.message
          }
        />
      ) : null}
      {screen.catalog.error ? (
        <Alert
          variant="warning"
          title="The app catalog could not be read"
          description={screen.catalog.error.message}
        />
      ) : null}
      <ConnectorsList
        search={screen.search}
        onSearch={screen.setSearch}
        filter={screen.filter}
        onFilter={screen.setFilter}
        counts={screen.counts}
        sections={screen.sections}
        selected={screen.selectedKey}
        onSelect={screen.setSelectedKey}
        footer={screen.footer}
        loading={screen.catalog.loading}
      />
      {compact || screen.filter === "mcp" ? (
        <View style={styles.addServer}>
          <Button
            size="sm"
            variant="ghost"
            leftIcon={Plus}
            onPress={onAddServer}
            testID="connectors-add-mcp"
          >
            Add MCP server
          </Button>
        </View>
      ) : null}
      {compact && screen.configured ? (
        <ComposioKeyRow serverId={serverId} keyHint={screen.settings.data?.composio.keyHint} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  master: { gap: theme.spacing[4] },
  // The ghost button's padding moves out, so its icon sits on the list's rail.
  addServer: { alignItems: "flex-start", marginLeft: -theme.spacing[3] },
}));
