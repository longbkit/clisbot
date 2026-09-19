import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { channelSupport } from "../channel-capability";
import type { ChannelCatalogEntry } from "../channel-catalog";

/**
 * What the Channel supports, as the Hub's integration implements it. It
 * describes the Channel, not a Connection: a Connection's own state is its
 * status.
 */
export function ChannelSupportSection({ entry }: { entry: ChannelCatalogEntry }) {
  const support = channelSupport(entry);
  const tools = entry.extraTools.map(agentToolLabel);
  return (
    <SettingsSection
      title="What it supports"
      info={`What Paseo's ${entry.label} integration can do in a conversation. It is the same for every ${entry.label} Connection.`}
    >
      <View style={[settingsStyles.card, styles.card]}>
        <View style={styles.chips}>
          {support.supported.map((label) => (
            <Text key={label} style={styles.chip}>
              {label}
            </Text>
          ))}
        </View>
        {support.limited.map(({ label, limit }) => (
          <View key={label}>
            <Text style={settingsStyles.rowTitle}>{`${label}, with a limit`}</Text>
            <Text style={settingsStyles.rowHint}>{limit}</Text>
          </View>
        ))}
        {tools.length === 0 ? null : (
          <Text style={settingsStyles.rowHint}>{`Extra Agent tools: ${tools.join(", ")}`}</Text>
        )}
        {support.unsupported.length === 0 ? null : (
          <Text style={settingsStyles.rowHint}>
            {`Not supported: ${support.unsupported.join(", ")}`}
          </Text>
        )}
      </View>
    </SettingsSection>
  );
}

/** "slack.emoji-list" → "emoji list": the channel is already on screen. */
function agentToolLabel(tool: string): string {
  const name = tool.includes(".") ? tool.slice(tool.indexOf(".") + 1) : tool;
  return name.replaceAll("-", " ");
}

const styles = StyleSheet.create((theme) => ({
  card: { padding: theme.spacing[4], gap: theme.spacing[3] },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[2] },
  chip: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
}));
