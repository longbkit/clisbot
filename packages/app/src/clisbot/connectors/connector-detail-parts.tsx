import { useCallback } from "react";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useRouter } from "expo-router";
import { connectorToolKindOf } from "@clisbot/protocol/connectors/types";
import type { ConnectorTool, ConnectorToolKind } from "@clisbot/protocol/connectors/types";
import { SettingsSection } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";

const ThemedSpinner = withUnistyles(LoadingSpinner, (theme) => ({
  color: theme.colors.foregroundMuted,
}));
import { StatusBadge } from "@/components/ui/status-badge";
import { settingsStyles } from "@/styles/settings";
import { buildProjectSettingsRoute } from "@/utils/host-routes";
import { buildHostBotRoute } from "../bots/routes";
import { ConnectorLogo } from "./connector-logo";
import { toolSelectionLabel, toolTitle, type ConnectorUse } from "./model";

/** Pieces both detail pages share: the header, Used by, and Tools. */

export function DetailHeader({
  slug,
  name,
  logo,
  subtitle,
  action,
}: {
  slug: string;
  name: string;
  logo?: string;
  subtitle: string;
  action?: React.ReactNode;
}) {
  return (
    <View style={styles.header}>
      <ConnectorLogo slug={slug} name={name} logo={logo} size="lg" />
      <View style={styles.headerText}>
        <Text style={styles.title} numberOfLines={1}>
          {name}
        </Text>
        <Text style={settingsStyles.rowHint} numberOfLines={2}>
          {subtitle}
        </Text>
      </View>
      {action}
    </View>
  );
}

export function UsedBySection({
  serverId,
  uses,
  empty,
}: {
  serverId: string;
  uses: ConnectorUse[];
  empty: string;
}) {
  return (
    <SettingsSection
      title="Used by"
      info="Bots and Projects whose agents may use this, and how. Change it in their settings."
    >
      <View style={settingsStyles.card}>
        {uses.length === 0 ? (
          <View style={settingsStyles.row}>
            <Text style={settingsStyles.rowHint}>{empty}</Text>
          </View>
        ) : (
          uses.map((use, index) => (
            <UsedByRow key={use.projectId} serverId={serverId} use={use} bordered={index > 0} />
          ))
        )}
      </View>
    </SettingsSection>
  );
}

function UsedByRow({
  serverId,
  use,
  bordered,
}: {
  serverId: string;
  use: ConnectorUse;
  bordered: boolean;
}) {
  const router = useRouter();
  const open = useCallback(
    () =>
      router.push(
        use.botId
          ? buildHostBotRoute(serverId, use.botId)
          : buildProjectSettingsRoute(serverId, use.projectId),
      ),
    [router, serverId, use.botId, use.projectId],
  );
  const access = use.access === undefined ? null : ACCESS_LABELS[use.access];
  return (
    <View style={[settingsStyles.row, bordered ? settingsStyles.rowBorder : null]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{use.name}</Text>
        <Text style={settingsStyles.rowHint}>
          {[
            use.botId ? "Bot" : "Project",
            use.enabled ? null : "Paused",
            access,
            toolSelectionLabel(use.tools),
          ]
            .filter(Boolean)
            .join(" · ")}
        </Text>
      </View>
      <Button size="xs" variant="ghost" onPress={open}>
        Edit
      </Button>
    </View>
  );
}

const ACCESS_LABELS = { read: "Read only", write: "Read and write" } as const;

export const TOOL_KIND_LABELS: Record<ConnectorToolKind, string> = {
  read: "Reads",
  write: "Changes data",
  send: "Sends",
};

export function ToolsSection({
  tools,
  toolkit,
  loading,
  error,
}: {
  /** The app the tools belong to, so its prefix drops from their names. */
  toolkit?: string;
  tools: ConnectorTool[] | undefined;
  loading: boolean;
  error: Error | null;
}) {
  return (
    <SettingsSection
      title={tools ? `Tools · ${tools.length}` : "Tools"}
      info="Reads run without asking. Tools that change data need Read and write. Tools that send ask first unless sends are allowed."
    >
      <View style={settingsStyles.card}>
        <ToolsBody tools={tools} toolkit={toolkit} loading={loading} error={error} />
      </View>
    </SettingsSection>
  );
}

function ToolsBody({
  tools,
  toolkit,
  loading,
  error,
}: {
  toolkit?: string;
  tools: ConnectorTool[] | undefined;
  loading: boolean;
  error: Error | null;
}) {
  if (loading) {
    return (
      <View style={settingsStyles.row}>
        <ThemedSpinner size="small" />
      </View>
    );
  }
  if (error) {
    return (
      <View style={settingsStyles.row}>
        <Text style={settingsStyles.rowError}>{error.message}</Text>
      </View>
    );
  }
  return (
    <>
      {(tools ?? []).map((tool, index) => (
        <ToolRow key={tool.name} tool={tool} toolkit={toolkit} bordered={index > 0} />
      ))}
    </>
  );
}

/**
 * A tool as people read it: its readable name first, what it does under that, and the name
 * agents call last and quietest, for someone matching a log or an approval.
 */
export function ToolLabel({ tool, toolkit }: { tool: ConnectorTool; toolkit?: string }) {
  return (
    <View style={settingsStyles.rowContent}>
      <Text style={settingsStyles.rowTitle} numberOfLines={1}>
        {toolTitle(tool, toolkit)}
      </Text>
      {tool.description ? (
        <Text style={settingsStyles.rowHint} numberOfLines={2}>
          {tool.description}
        </Text>
      ) : null}
      <Text style={styles.toolName} numberOfLines={1}>
        {tool.name}
      </Text>
    </View>
  );
}

function ToolRow({
  tool,
  toolkit,
  bordered,
}: {
  tool: ConnectorTool;
  toolkit?: string;
  bordered: boolean;
}) {
  return (
    <View style={[settingsStyles.row, bordered ? settingsStyles.rowBorder : null]}>
      <ToolLabel tool={tool} toolkit={toolkit} />
      <StatusBadge
        label={TOOL_KIND_LABELS[connectorToolKindOf(tool.kind)]}
        variant={connectorToolKindOf(tool.kind) === "send" ? "warning" : "muted"}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  // On a phone the action wraps under the name instead of squeezing it.
  header: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing[3],
    marginBottom: theme.spacing[6],
  },
  headerText: { flexGrow: 1, flexShrink: 1, flexBasis: 200, minWidth: 200, gap: theme.spacing[1] },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.normal,
  },
  toolName: {
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.sm,
    fontFamily: theme.fontFamily.mono,
    marginTop: theme.spacing[1],
  },
}));
