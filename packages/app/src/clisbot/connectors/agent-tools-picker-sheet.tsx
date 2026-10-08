import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { AgentToolGroup } from "@clisbot/protocol/connectors/agent-tools";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { settingsStyles } from "@/styles/settings";
import {
  agentToolDescription,
  agentToolGroupDescription,
  agentToolGroupLabel,
} from "./agent-tool-copy";
import { CheckOption } from "./check-option";

/**
 * Picks which tools of one group a Project's agents may call: each tool by what it does, with its
 * name under it, as the Connector tool picker does. Saving writes the whole group.
 */
export function AgentToolsPickerSheet({
  group,
  initial,
  onClose,
  onSave,
}: {
  group: AgentToolGroup;
  initial: readonly string[];
  onClose(): void;
  onSave(enabled: string[]): void;
}) {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState<string[]>([...initial]);
  const toggle = useCallback(
    (name: string) =>
      setEnabled((current) =>
        current.includes(name) ? current.filter((other) => other !== name) : [...current, name],
      ),
    [],
  );
  const all = useCallback(() => setEnabled(group.tools.map((tool) => tool.name)), [group]);
  const none = useCallback(() => setEnabled([]), []);
  const save = useCallback(() => onSave(enabled), [enabled, onSave]);
  const header = useMemo(
    () => ({
      title: t("connectors.tools.agentTools.groupTools", { group: agentToolGroupLabel(group) }),
      subtitle: agentToolGroupDescription(group),
    }),
    [group, t],
  );
  const footer = useMemo(
    () => (
      <View style={styles.footer}>
        <View style={styles.group}>
          <Button variant="ghost" size="sm" onPress={all}>
            {t("connectors.tools.common.all")}
          </Button>
          <Button variant="ghost" size="sm" onPress={none}>
            {t("connectors.tools.common.none")}
          </Button>
        </View>
        <View style={styles.group}>
          <Button variant="ghost" onPress={onClose}>
            {t("connectors.tools.common.cancel")}
          </Button>
          <Button variant="default" onPress={save} testID="agent-tools-save">
            {t("connectors.tools.common.save")}
          </Button>
        </View>
      </View>
    ),
    [all, none, onClose, save, t],
  );
  return (
    <AdaptiveModalSheet
      header={header}
      visible
      onClose={onClose}
      footer={footer}
      desktopMaxWidth={520}
      desktopHeight="70%"
    >
      <View style={settingsStyles.card}>
        {group.tools.map((tool, index) => (
          <CheckOption
            key={tool.name}
            id={tool.name}
            bordered={index > 0}
            checked={enabled.includes(tool.name)}
            onToggle={toggle}
            testID={`agent-tool-${tool.name}`}
          >
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>{agentToolDescription(tool)}</Text>
              <Text style={styles.name}>{tool.name}</Text>
            </View>
          </CheckOption>
        ))}
      </View>
    </AdaptiveModalSheet>
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
  name: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontFamily: theme.fontFamily.mono,
    marginTop: theme.spacing[1],
  },
}));
