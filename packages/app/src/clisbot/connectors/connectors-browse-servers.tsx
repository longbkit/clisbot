import { Plus } from "lucide-react-native";
import { useCallback, useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { mcpServerSummary } from "./model";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { ConnectorMcpServer } from "@clisbot/protocol/connectors/types";
import { SettingsSection } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { settingsStyles } from "@/styles/settings";
import { ConnectorLogo, serverLogoKey } from "./connector-logo";

/** The overview's MCP servers: each one opens its detail; the button adds another. */
export function BrowseServersSection({
  servers,
  onSelect,
  onAdd,
}: {
  servers: ConnectorMcpServer[];
  onSelect(name: string): void;
  onAdd(): void;
}) {
  const { t } = useTranslation();
  const add = useMemo(
    () => (
      <Button
        size="xs"
        variant="ghost"
        leftIcon={Plus}
        onPress={onAdd}
        testID="connectors-browse-add-mcp"
      >
        {t("connectors.screen.common.addMcpServer")}
      </Button>
    ),
    [onAdd, t],
  );
  return (
    <SettingsSection
      title={t("connectors.screen.common.mcpServers")}
      info={t("connectors.screen.browse.serversInfo")}
      trailing={add}
    >
      {servers.length === 0 ? null : (
        <View style={settingsStyles.card}>
          {servers.map((server, index) => (
            <ServerRow key={server.name} server={server} bordered={index > 0} onSelect={onSelect} />
          ))}
        </View>
      )}
    </SettingsSection>
  );
}

function ServerRow({
  server,
  bordered,
  onSelect,
}: {
  server: ConnectorMcpServer;
  bordered: boolean;
  onSelect(name: string): void;
}) {
  const press = useCallback(() => onSelect(server.name), [onSelect, server.name]);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={press}
      style={bordered ? [styles.row, settingsStyles.rowBorder] : styles.row}
    >
      <ConnectorLogo slug={serverLogoKey(server.name)} name={server.name} />
      <Text style={[settingsStyles.rowTitle, settingsStyles.rowContent]}>{server.name}</Text>
      <Text style={settingsStyles.rowHint}>{mcpServerSummary(server)}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
  },
}));
