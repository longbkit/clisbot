import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { connectorToolKindOf } from "@clisbot/protocol/connectors/types";
import type { ConnectorTool, ConnectorToolSelection } from "@clisbot/protocol/connectors/types";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";

import { StatusBadge } from "@/components/ui/status-badge";
import { settingsStyles } from "@/styles/settings";
import { TOOL_KIND_LABELS, ToolLabel } from "./connector-detail-parts";
import { useConnectorTools } from "./data";
import { matchesSearch, toggleTool } from "./model";
import { CheckOption } from "./check-option";

const ThemedSpinner = withUnistyles(LoadingSpinner, (theme) => ({
  color: theme.colors.foregroundMuted,
}));

/** Picks which tools of one app or server a Project may call. Saving writes the whole list. */
export function ToolPickerSheet({
  serverId,
  target,
  title,
  initial,
  onClose,
  onSave,
}: {
  serverId: string;
  target: { app: string } | { mcpServer: string };
  title: string;
  initial: ConnectorToolSelection;
  onClose(): void;
  onSave(selection: ConnectorToolSelection): void;
}) {
  const tools = useConnectorTools(serverId, target);
  const [selection, setSelection] = useState(initial);
  const [search, setSearch] = useState("");
  const names = useMemo(() => (tools.data ?? []).map((tool) => tool.name), [tools.data]);
  const shown = useMemo(
    () => (tools.data ?? []).filter((tool) => matchesSearch(tool, search)),
    [search, tools.data],
  );
  const toggle = useCallback(
    (name: string) => setSelection((current) => toggleTool(current, name, names)),
    [names],
  );
  const all = useCallback(() => setSelection("all"), []);
  const none = useCallback(() => setSelection([]), []);
  const save = useCallback(() => onSave(selection), [onSave, selection]);
  const header = useMemo(
    () => ({ title, search: { onChange: setSearch, placeholder: "Search tools" } }),
    [title],
  );
  const footer = useMemo(
    () => (
      <View style={styles.footer}>
        <View style={styles.group}>
          <Button variant="ghost" size="sm" onPress={all}>
            All
          </Button>
          <Button variant="ghost" size="sm" onPress={none}>
            None
          </Button>
        </View>
        <View style={styles.group}>
          <Button variant="ghost" onPress={onClose}>
            Cancel
          </Button>
          <Button variant="default" onPress={save} testID="connectors-tools-save">
            Save
          </Button>
        </View>
      </View>
    ),
    [all, none, onClose, save],
  );
  return (
    <AdaptiveModalSheet
      header={header}
      visible
      onClose={onClose}
      footer={footer}
      desktopMaxWidth={560}
      desktopHeight="70%"
    >
      {tools.isLoading ? <ThemedSpinner /> : null}
      {tools.error ? <Text style={settingsStyles.rowError}>{tools.error.message}</Text> : null}
      <View style={settingsStyles.card}>
        {shown.map((tool, index) => (
          <ToolOption
            toolkit={"app" in target ? target.app : undefined}
            key={tool.name}
            tool={tool}
            bordered={index > 0}
            checked={selection === "all" || selection.includes(tool.name)}
            onToggle={toggle}
          />
        ))}
      </View>
    </AdaptiveModalSheet>
  );
}

function ToolOption({
  tool,
  toolkit,
  bordered,
  checked,
  onToggle,
}: {
  tool: ConnectorTool;
  toolkit?: string;
  bordered: boolean;
  checked: boolean;
  onToggle(name: string): void;
}) {
  const kind = connectorToolKindOf(tool.kind);
  return (
    <CheckOption id={tool.name} bordered={bordered} checked={checked} onToggle={onToggle}>
      <ToolLabel tool={tool} toolkit={toolkit} />
      <StatusBadge label={TOOL_KIND_LABELS[kind]} variant={kind === "send" ? "warning" : "muted"} />
    </CheckOption>
  );
}

const styles = StyleSheet.create((theme) => ({
  footer: {
    flexGrow: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  group: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
}));
