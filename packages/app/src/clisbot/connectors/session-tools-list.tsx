import { ChevronRight } from "lucide-react-native";
import { useCallback, useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { ConnectorGrant } from "@clisbot/protocol/connectors/types";
import { SettingsSection } from "@/components/settings";
import { Switch } from "@/components/ui/switch";
import { i18n } from "@/i18n/i18next";
import { settingsStyles } from "@/styles/settings";
import { ICON_SIZE } from "@/styles/theme";
import { AgentToolGroupIcon } from "./agent-tools-section";
import { agentToolGroupDescription, agentToolGroupLabel } from "./agent-tool-copy";
import { setGroupOn, toolCountSummary } from "./agent-tools-model";
import { ConnectorLogo, serverLogoKey } from "./connector-logo";
import type { ConnectorLookup } from "./connector-lookup";
import { appGrantSummary } from "./grant-rows";
import { toolSelectionLabel } from "./model";
import {
  sessionKeptTools,
  setSessionKeptTools,
  toggled,
  type SessionOffEdit,
} from "./session-connectors";
import type { SessionConnector, SessionToolGroup, SessionTools } from "./session-tools";
import { offInOwner, type ProjectEdits } from "./session-tool-pages";
import { withAllows } from "./session-allows";
import { agentToolOffKey } from "@clisbot/protocol/connectors/agent-tools";
import { confirmDialog } from "@/utils/confirm-dialog";
import { toErrorMessage } from "@/utils/error-messages";

/**
 * The first page of the session's Tools sheet: the Clisbot tool groups and the Connectors, each
 * with its switch for this session and a chevron to its tools (design.md §12).
 */

type Apply = (edit: SessionOffEdit) => void;

const ThemedChevron = withUnistyles(ChevronRight, (theme) => ({
  color: theme.colors.foregroundMuted,
}));

export const groupPage = (id: string) => `group:${id}`;
export const connectorPage = (key: string) => `connector:${key}`;

export function ListPage({
  tools,
  grant,
  lookup,
  off,
  apply,
  onOpen,
  onAllConnectors,
  project,
}: {
  project: ProjectEdits;
  tools: SessionTools;
  grant: ConnectorGrant | undefined;
  lookup: ConnectorLookup;
  off: ReadonlySet<string>;
  apply: Apply;
  onOpen(page: string): void;
  onAllConnectors(): void;
}) {
  const { t } = useTranslation();
  const allConnectors = useMemo(
    () => (
      <SectionLink label={t("connectors.tools.common.allConnectors")} onPress={onAllConnectors} />
    ),
    [onAllConnectors, t],
  );
  return (
    <>
      {tools.groups.length > 0 ? (
        <SettingsSection title={t("connectors.tools.common.clisbotTools")}>
          <View style={settingsStyles.card}>
            {tools.groups.map((entry, index) => (
              <GroupRow
                key={entry.group.id}
                entry={entry}
                bordered={index > 0}
                off={off}
                apply={apply}
                project={project}
                onOpen={onOpen}
              />
            ))}
          </View>
        </SettingsSection>
      ) : null}
      {tools.connectors.length > 0 ? (
        <SettingsSection title={t("connectors.tools.common.connectors")} trailing={allConnectors}>
          <View style={settingsStyles.card}>
            {tools.connectors.map((entry, index) => (
              <ConnectorRow
                key={entry.key}
                entry={entry}
                grant={grant}
                lookup={lookup}
                bordered={index > 0}
                off={off}
                apply={apply}
                onOpen={onOpen}
              />
            ))}
          </View>
        </SettingsSection>
      ) : null}
    </>
  );
}

/** "All connectors ›": opens a full list elsewhere, like a section's "See all". */
export function SectionLink({ label, onPress }: { label: string; onPress(): void }) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      style={styles.link}
      testID="session-tools-all-connectors"
    >
      <Text style={styles.linkLabel}>{label}</Text>
      <ThemedChevron size={12} />
    </Pressable>
  );
}

/** A row that opens a page: icon, name, summary, the session's switch, a chevron. */
export function OpeningRow({
  page,
  icon,
  title,
  summary,
  bordered,
  on,
  onSwitch,
  onOpen,
  testID,
}: {
  page: string;
  icon: ReactNode;
  title: string;
  summary: string;
  bordered: boolean;
  on: boolean;
  onSwitch(value: boolean): void;
  onOpen(page: string): void;
  testID: string;
}) {
  const open = useCallback(() => onOpen(page), [onOpen, page]);
  const rowStyle = useCallback(
    ({ hovered }: { hovered?: boolean }) => [
      styles.row,
      bordered ? settingsStyles.rowBorder : null,
      hovered ? styles.hovered : null,
    ],
    [bordered],
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${summary}`}
      onPress={open}
      style={rowStyle}
      testID={testID}
    >
      {icon}
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{title}</Text>
        <Text style={settingsStyles.rowHint} numberOfLines={1}>
          {summary}
        </Text>
      </View>
      <Switch value={on} onValueChange={onSwitch} accessibilityLabel={title} />
      <ThemedChevron size={ICON_SIZE.sm} />
    </Pressable>
  );
}

/**
 * A group the Project leaves off: a running session gets its tools for itself; a draft asks, then
 * turns the group on for the Project.
 */
async function turnOnGroupPastProject(
  entry: SessionToolGroup,
  project: ProjectEdits,
  apply: Apply,
) {
  const { group } = entry;
  const names = group.tools.map((tool) => tool.name);
  // The group's own off keys would keep it off once the Project or the allows give it.
  const keepOn: SessionOffEdit = (current) =>
    setSessionKeptTools(current, { ...entry.set, given: names }, names);
  try {
    if (project.editAllows) {
      const keys = names.map((name) => agentToolOffKey(name));
      await project.editAllows((current) => new Set([...current, ...keys]));
      apply(keepOn);
      return;
    }
    const confirmed = await confirmDialog({
      title: i18n.t("connectors.tools.common.turnOnTitle", { name: agentToolGroupLabel(group) }),
      message: i18n.t("connectors.tools.pages.confirmGroup"),
      confirmLabel: i18n.t("connectors.tools.common.turnOnForProject"),
    });
    if (!confirmed) return;
    await project.save((grant) => setGroupOn(grant, group, true, project.defaults));
    apply(keepOn);
  } catch (cause) {
    project.onError(toErrorMessage(cause));
  }
}

function GroupRow({
  entry,
  bordered,
  off,
  apply,
  project,
  onOpen,
}: {
  entry: SessionToolGroup;
  bordered: boolean;
  off: ReadonlySet<string>;
  apply: Apply;
  project: ProjectEdits;
  onOpen(page: string): void;
}) {
  const { group } = entry;
  const set = useMemo(
    () =>
      withAllows(
        entry.set,
        group.tools.map((tool) => tool.name),
        project.allows,
      ),
    [entry.set, group.tools, project.allows],
  );
  const kept = sessionKeptTools(set, off);
  const offInProject = set.given.length === 0;
  const toggle = useCallback(
    (value: boolean) => {
      if (value && offInProject) {
        void turnOnGroupPastProject(entry, project, apply);
        return;
      }
      apply((current) => setSessionKeptTools(current, set, value ? set.given : []));
    },
    [apply, entry, offInProject, project, set],
  );
  const dimmed = kept.length === 0;
  const icon = useMemo(
    () => <AgentToolGroupIcon group={group.id} dimmed={dimmed} />,
    [dimmed, group.id],
  );
  return (
    <OpeningRow
      page={groupPage(group.id)}
      icon={icon}
      title={agentToolGroupLabel(group)}
      summary={`${offInProject ? offInOwner(project.owner) : toolCountSummary(kept.length, group.tools.length)} · ${agentToolGroupDescription(group)}`}
      bordered={bordered}
      on={kept.length > 0}
      onSwitch={toggle}
      onOpen={onOpen}
      testID={`session-tools-group-${group.id}`}
    />
  );
}

function ConnectorRow({
  entry,
  grant,
  lookup,
  bordered,
  off,
  apply,
  onOpen,
}: {
  entry: SessionConnector;
  grant: ConnectorGrant | undefined;
  lookup: ConnectorLookup;
  bordered: boolean;
  off: ReadonlySet<string>;
  apply: Apply;
  onOpen(page: string): void;
}) {
  const { t } = useTranslation();
  const change = useCallback(
    () => apply((current) => toggled(current, entry.key)),
    [apply, entry.key],
  );
  const display = connectorDisplay(entry, grant, lookup);
  const icon = useMemo(
    () => <ConnectorLogo slug={display.slug} name={display.name} logo={display.logo} />,
    [display.logo, display.name, display.slug],
  );
  const toolsOff = [...off].filter((key) => key.startsWith(`${entry.key}/`)).length;
  const summary =
    toolsOff > 0
      ? `${display.summary} · ${t("connectors.tools.common.offHere", { count: toolsOff })}`
      : display.summary;
  return (
    <OpeningRow
      page={connectorPage(entry.key)}
      icon={icon}
      title={display.name}
      summary={summary}
      bordered={bordered}
      on={!off.has(entry.key)}
      onSwitch={change}
      onOpen={onOpen}
      testID={`session-tools-connector-${entry.key}`}
    />
  );
}

/** A Connector's name, logo and how the Project set it up, as its row in Project settings says. */
export function connectorDisplay(
  entry: SessionConnector,
  grant: ConnectorGrant | undefined,
  lookup: ConnectorLookup,
) {
  if (entry.target.kind === "app") {
    const slug = entry.target.slug;
    const app = grant?.apps?.[slug];
    return {
      name: lookup.name(slug),
      logo: lookup.logo(slug),
      slug,
      summary: app ? appGrantSummary(slug, app, lookup).text : "",
    };
  }
  const name = entry.target.name;
  const tools = grant?.mcpServers?.[name]?.tools ?? "all";
  return {
    name,
    logo: undefined,
    slug: serverLogoKey(name),
    summary: i18n.t("connectors.tools.list.mcpServer", { tools: toolSelectionLabel(tools) }),
  };
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    padding: theme.spacing[3],
  },
  hovered: { backgroundColor: theme.colors.surface1 },
  link: { flexDirection: "row", alignItems: "center", gap: theme.spacing[1] },
  linkLabel: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
}));
