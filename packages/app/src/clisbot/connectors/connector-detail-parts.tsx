import { useCallback } from "react";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { i18n } from "@/i18n/i18next";
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
import { accessLabel, toolSelectionLabel, toolTitle, type ConnectorUse } from "./model";

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
  const { t } = useTranslation();
  return (
    <SettingsSection
      title={t("connectors.screen.parts.usedBy")}
      info={t("connectors.screen.parts.usedByInfo")}
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
  const { t } = useTranslation();
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
  const access = use.access === undefined ? null : accessLabel(use.access);
  return (
    <View style={[settingsStyles.row, bordered ? settingsStyles.rowBorder : null]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{use.name}</Text>
        <Text style={settingsStyles.rowHint}>
          {[
            use.botId ? t("connectors.screen.common.bot") : t("connectors.screen.common.project"),
            use.enabled ? null : t("connectors.screen.common.paused"),
            access,
            toolSelectionLabel(use.tools),
          ]
            .filter(Boolean)
            .join(" · ")}
        </Text>
      </View>
      <Button size="xs" variant="ghost" onPress={open}>
        {t("connectors.screen.common.edit")}
      </Button>
    </View>
  );
}

/** Each label resolves when read, so it follows the app's language. */
export const TOOL_KIND_LABELS: Record<ConnectorToolKind, string> = {
  get read() {
    return i18n.t("connectors.screen.parts.kinds.read");
  },
  get write() {
    return i18n.t("connectors.screen.parts.kinds.write");
  },
  get send() {
    return i18n.t("connectors.screen.parts.kinds.send");
  },
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
  const { t } = useTranslation();
  const title = t("connectors.screen.common.tools");
  return (
    <SettingsSection
      title={tools ? `${title} · ${tools.length}` : title}
      info={t("connectors.screen.parts.toolsInfo")}
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
