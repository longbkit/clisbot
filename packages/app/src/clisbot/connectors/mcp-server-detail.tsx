import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { ConnectorMcpServer } from "@clisbot/protocol/connectors/types";
import { SettingsSection } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { i18n } from "@/i18n/i18next";
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
  const { t } = useTranslation();
  const tools = useConnectorTools(
    serverId,
    useMemo(() => ({ mcpServer: server.name }), [server.name]),
  );
  const remove = useRemove(serverId, server.name, onRemoved);
  const where =
    server.transport === "http"
      ? (server.url ?? "")
      : [server.command, ...(server.args ?? [])].join(" ");
  const runsAt =
    server.transport === "http"
      ? t("connectors.screen.mcp.remote")
      : t("connectors.screen.mcp.local");
  const subtitle =
    server.enabled === false ? `${runsAt} · ${t("connectors.screen.common.off")}` : runsAt;
  const editAction = useMemo(
    () => (
      <Button variant="outline" size="sm" onPress={onEdit} testID="connectors-mcp-edit">
        {t("connectors.screen.mcp.editServer")}
      </Button>
    ),
    [onEdit, t],
  );
  return (
    <View>
      <DetailHeader slug={server.name} name={server.name} subtitle={subtitle} action={editAction} />
      <SettingsSection
        title={t("connectors.screen.mcp.server")}
        info={t("connectors.screen.mcp.serverInfo")}
      >
        <View style={settingsStyles.card}>
          <McpServerToggle serverId={serverId} server={server} />
          <View style={settingsStyles.rowBorder}>
            <Row
              label={
                server.transport === "http"
                  ? t("connectors.screen.mcp.url")
                  : t("connectors.screen.mcp.command")
              }
              value={where}
            />
          </View>
          <Row
            label={
              server.transport === "http"
                ? t("connectors.screen.mcp.headers")
                : t("connectors.screen.mcp.environment")
            }
            value={secretNames(server)}
            bordered
          />
        </View>
      </SettingsSection>
      <UsedBySection
        serverId={serverId}
        uses={uses}
        empty={t("connectors.screen.common.usedByEmpty", { name: server.name })}
      />
      <ToolsSection tools={tools.data} loading={tools.isLoading} error={tools.error} />
      <View style={styles.remove}>
        <Button variant="ghost" size="sm" loading={remove.busy} onPress={remove.run}>
          {t("connectors.screen.mcp.removeServer")}
        </Button>
        {remove.error ? <Text style={settingsStyles.rowError}>{remove.error}</Text> : null}
      </View>
    </View>
  );
}

function secretNames(server: ConnectorMcpServer): string {
  const names = server.transport === "http" ? server.headerKeys : server.envKeys;
  return names?.length ? names.join(", ") : i18n.t("connectors.screen.mcp.none");
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
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async () => {
    const confirmed = await confirmDialog({
      title: t("connectors.screen.common.removeTitle", { name }),
      message: t("connectors.screen.mcp.removeMessage"),
      confirmLabel: t("connectors.screen.mcp.removeConfirm"),
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
  }, [name, onRemoved, serverId, t]);
  return { busy, error, run: () => void run() };
}

const styles = StyleSheet.create((theme) => ({
  label: { width: 96, marginTop: 0 },
  value: { flex: 1, minWidth: 0 },
  remove: { alignItems: "flex-start", gap: theme.spacing[1], marginLeft: -theme.spacing[3] },
}));
