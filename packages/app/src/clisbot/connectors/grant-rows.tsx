import { ChevronRight } from "lucide-react-native";
import { useCallback } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { connectorAccessOf } from "@clisbot/protocol/connectors/types";
import { i18n } from "@/i18n/i18next";
import type { ConnectorToolSelection } from "@clisbot/protocol/connectors/types";
import { Switch } from "@/components/ui/switch";
import { settingsStyles } from "@/styles/settings";
import { ICON_SIZE } from "@/styles/theme";
import type { ConnectorLookup } from "./connector-lookup";
import { ConnectorLogo, serverLogoKey } from "./connector-logo";
import {
  accessLabel,
  accountSelectionLabel,
  setAppEnabled,
  setMcpServerEnabled,
  toolSelectionLabel,
} from "./model";
import type { GrantEdit } from "./use-grant-editor";

/**
 * A Project's Connectors as rows (design.md §12): logo, name, how it is set up after a dot, the
 * switch that pauses it, and a chevron. The row opens its sheet (`grant-sheet.tsx`); nothing else
 * is edited on the row.
 */

const ThemedChevron = withUnistyles(ChevronRight, (theme) => ({
  color: theme.colors.foregroundMuted,
}));

export type GrantTarget = { kind: "app"; slug: string } | { kind: "mcp"; name: string };

export interface AppGrantEntry {
  /** As stored; an unknown level shows and behaves as Read only. */
  access: string;
  tools: ConnectorToolSelection;
  accounts?: "all" | string[];
  enabled?: boolean;
}

/** "Read only · All tools", "No sign-in needed", or what keeps it from working. */
export function appGrantSummary(slug: string, app: AppGrantEntry, lookup: ConnectorLookup) {
  if (app.enabled === false) {
    return { text: i18n.t("connectors.screen.common.paused"), warning: false };
  }
  if (!lookup.connected(slug)) {
    return { text: i18n.t("connectors.screen.grantRows.notConnected"), warning: true };
  }
  const parts = [accessLabel(connectorAccessOf(app.access)), toolSelectionLabel(app.tools)];
  if (lookup.noAuth(slug)) parts.push(i18n.t("connectors.screen.common.noSignIn"));
  else if (app.accounts !== undefined && app.accounts !== "all") {
    parts.push(accountSelectionLabel(app.accounts, lookup.accounts(slug)));
  }
  return { text: parts.join(" · "), warning: false };
}

export function AppGrantRow({
  slug,
  app,
  lookup,
  bordered,
  apply,
  onOpen,
}: {
  slug: string;
  app: AppGrantEntry;
  lookup: ConnectorLookup;
  bordered: boolean;
  apply(edit: GrantEdit): void;
  onOpen(target: GrantTarget): void;
}) {
  const name = lookup.name(slug);
  const setOn = useCallback(
    (value: boolean) => apply((grant) => setAppEnabled(grant, slug, value)),
    [apply, slug],
  );
  const open = useCallback(() => onOpen({ kind: "app", slug }), [onOpen, slug]);
  const summary = appGrantSummary(slug, app, lookup);
  return (
    <GrantRow
      name={name}
      summary={summary.text}
      warning={summary.warning}
      on={app.enabled !== false}
      bordered={bordered}
      onToggle={setOn}
      onPress={open}
      testID={`bot-connectors-app-${slug}`}
    >
      <ConnectorLogo slug={slug} name={name} logo={lookup.logo(slug)} />
    </GrantRow>
  );
}

export function ServerGrantRow({
  name,
  tools,
  enabled,
  bordered,
  apply,
  onOpen,
}: {
  name: string;
  tools: ConnectorToolSelection;
  enabled: boolean;
  bordered: boolean;
  apply(edit: GrantEdit): void;
  onOpen(target: GrantTarget): void;
}) {
  const { t } = useTranslation();
  const setOn = useCallback(
    (value: boolean) => apply((grant) => setMcpServerEnabled(grant, name, value)),
    [apply, name],
  );
  const open = useCallback(() => onOpen({ kind: "mcp", name }), [name, onOpen]);
  return (
    <GrantRow
      name={name}
      summary={
        enabled
          ? `${t("connectors.screen.common.mcpServer")} · ${toolSelectionLabel(tools)}`
          : t("connectors.screen.common.paused")
      }
      warning={false}
      on={enabled}
      bordered={bordered}
      onToggle={setOn}
      onPress={open}
      testID={`bot-connectors-mcp-${name}`}
    >
      <ConnectorLogo slug={serverLogoKey(name)} name={name} />
    </GrantRow>
  );
}

function GrantRow({
  name,
  summary,
  warning,
  on,
  bordered,
  onToggle,
  onPress,
  testID,
  children,
}: {
  name: string;
  summary: string;
  warning: boolean;
  on: boolean;
  bordered: boolean;
  onToggle(value: boolean): void;
  onPress(): void;
  testID: string;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${summary}`}
      onPress={onPress}
      style={bordered ? rowStyleBordered : rowStyle}
      testID={testID}
    >
      <View style={on ? null : styles.paused}>{children}</View>
      <View style={[settingsStyles.rowContent, styles.line]}>
        <Text style={settingsStyles.rowTitle} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.separator}>·</Text>
        {warning ? <View style={styles.warningDot} /> : null}
        <Text style={styles.summary} numberOfLines={1}>
          {summary}
        </Text>
      </View>
      {/* The Switch stops its press, so toggling never opens the sheet. */}
      <Switch
        value={on}
        onValueChange={onToggle}
        accessibilityLabel={t("connectors.screen.grantRows.useSwitch", { name })}
      />
      <ThemedChevron size={ICON_SIZE.sm} />
    </Pressable>
  );
}

function rowStyle({ hovered }: { hovered?: boolean }) {
  return [styles.row, hovered ? styles.hovered : null];
}

function rowStyleBordered({ hovered }: { hovered?: boolean }) {
  return [styles.row, settingsStyles.rowBorder, hovered ? styles.hovered : null];
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
  },
  hovered: { backgroundColor: theme.colors.surface1 },
  line: { flexDirection: "row", alignItems: "center", minWidth: 0 },
  separator: { color: theme.colors.foregroundMuted, marginHorizontal: theme.spacing[1.5] },
  summary: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm, flexShrink: 1 },
  warningDot: {
    width: 7,
    height: 7,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.statusWarning,
    marginRight: theme.spacing[1.5],
  },
  // Paused reads as disabled: opacity only (design.md §14).
  paused: { opacity: theme.opacity[50] },
}));
