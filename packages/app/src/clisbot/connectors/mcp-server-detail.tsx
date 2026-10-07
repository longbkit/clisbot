import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { ConnectorMcpServer } from "@clisbot/protocol/connectors/types";
import { SettingsSection } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { settingsStyles } from "@/styles/settings";
import { confirmDialog } from "@/utils/confirm-dialog";
import { DetailHeader, ToolsSection, UsedBySection } from "./connector-detail-parts";
import { removeMcpServer, useConnectorTools } from "./data";
import { McpServerToggle } from "./mcp-server-toggle";
import type { ConnectorUse } from "./model";
import { toErrorMessage } from "@/utils/error-messages";

/** One MCP server the user added: where it runs, which Bots and Projects use it, and its tools. */
export function McpServerDetail({
  serverId,
  server,
  uses,
  onEdit,
  onRemoved,
}: {
  serverId: string;
  server: ConnectorMcpServer;
  uses: ConnectorUse[];
  onEdit(): void;
  onRemoved(): void;
}) {
  const tools = useConnectorTools(
    serverId,
    useMemo(() => ({ mcpServer: server.name }), [server.name]),
  );
  const remove = useRemove(serverId, server.name, onRemoved);
  const where =
    server.transport === "http"
      ? (server.url ?? "")
      : [server.command, ...(server.args ?? [])].join(" ");
  const runsAt = server.transport === "http" ? "Remote MCP server" : "Runs on this Host";
  const subtitle = server.enabled === false ? `${runsAt} · Off` : runsAt;
  const editAction = useMemo(
    () => (
      <Button variant="outline" size="sm" onPress={onEdit} testID="connectors-mcp-edit">
        Edit server
      </Button>
    ),
    [onEdit],
  );
  return (
    <View>
      <DetailHeader slug={server.name} name={server.name} subtitle={subtitle} action={editAction} />
      <SettingsSection
        title="Server"
        info="Secret values stay on this Host. Agents reach a remote server through the Host, so they never hold its headers."
      >
        <View style={settingsStyles.card}>
          <McpServerToggle serverId={serverId} server={server} />
          <View style={settingsStyles.rowBorder}>
            <Row label={server.transport === "http" ? "URL" : "Command"} value={where} />
          </View>
          <Row
            label={server.transport === "http" ? "Headers" : "Environment"}
            value={secretNames(server)}
            bordered
          />
        </View>
      </SettingsSection>
      <UsedBySection
        serverId={serverId}
        uses={uses}
        empty={`Nothing uses ${server.name} yet. Add it in a Bot's or Project's settings → Connectors.`}
      />
      <ToolsSection tools={tools.data} loading={tools.isLoading} error={tools.error} />
      <View style={styles.remove}>
        <Button variant="ghost" size="sm" loading={remove.busy} onPress={remove.run}>
          Remove server…
        </Button>
        {remove.error ? <Text style={settingsStyles.rowError}>{remove.error}</Text> : null}
      </View>
    </View>
  );
}

function secretNames(server: ConnectorMcpServer): string {
  const names = server.transport === "http" ? server.headerKeys : server.envKeys;
  return names?.length ? names.join(", ") : "None";
}

function Row({
  label,
  value,
  bordered = false,
}: {
  label: string;
  value: string;
  bordered?: boolean;
}) {
  return (
    <View style={[settingsStyles.row, bordered ? settingsStyles.rowBorder : null]}>
      <Text style={[settingsStyles.rowHint, styles.label]}>{label}</Text>
      <Text style={[settingsStyles.rowTitle, styles.value]} selectable numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

function useRemove(serverId: string, name: string, onRemoved: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async () => {
    const confirmed = await confirmDialog({
      title: `Remove ${name}?`,
      message:
        "Agents that use it lose its tools from their next session. Its stored headers and variables are deleted.",
      confirmLabel: "Remove server",
      destructive: true,
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      await removeMcpServer(serverId, name);
      onRemoved();
    } catch (cause) {
      setError(toErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }, [name, onRemoved, serverId]);
  return { busy, error, run: () => void run() };
}

const styles = StyleSheet.create((theme) => ({
  label: { width: 96, marginTop: 0 },
  value: { flex: 1, minWidth: 0 },
  remove: { alignItems: "flex-start", gap: theme.spacing[1], marginLeft: -theme.spacing[3] },
}));
