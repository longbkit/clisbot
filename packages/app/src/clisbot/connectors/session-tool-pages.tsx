import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  connectorToolKindOf,
  type ConnectorGrant,
  type ConnectorTool,
  type ConnectorToolKind,
} from "@clisbot/protocol/connectors/types";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { i18n } from "@/i18n/i18next";
import { settingsStyles } from "@/styles/settings";
import { confirmDialog } from "@/utils/confirm-dialog";
import { toErrorMessage } from "@/utils/error-messages";
import type { AgentToolDefaults } from "./agent-tools-model";
import { agentToolDescription } from "./agent-tool-copy";
import { TOOL_KIND_LABELS, ToolLabel } from "./connector-detail-parts";
import { useConnectorTools } from "./data";
import { toolTitle } from "./model";
import {
  allowAppTool,
  allowGroupTool,
  allowServerTool,
  connectorToolRefusal,
  type ProjectToolRefusal,
} from "./project-allow-tool";
import {
  sessionKeptTools,
  setSessionKeptTools,
  type SessionOffEdit,
  type SessionToolSet,
} from "./session-connectors";
import { SessionSwitchRow, type SessionRowBadge } from "./session-switch-row";
import { withAllows } from "./session-allows";
import type { SessionConnector, SessionToolGroup } from "./session-tools";
import type { GrantEdit } from "./use-grant-editor";

/**
 * The pages of the session's Tools sheet that list a set's tools, each with its switch for this
 * session: a Clisbot tool group, and a Connector. A tool the Project leaves off says why and links
 * to the Project's Tools tab; its switch turns it on for this session only, in a list the daemon
 * keeps (the agent cannot write it). A draft has no session yet, so there it asks and turns the
 * tool on for the Project.
 */

type Apply = (edit: SessionOffEdit) => void;

/** What the pages need to go past the Project: this session's allows, or the Project itself. */
export interface ProjectEdits {
  defaults: AgentToolDefaults | undefined;
  save(edit: GrantEdit): Promise<unknown>;
  manage(): void;
  onError(message: string): void;
  /** The tools this session may use beyond the Project, by their off-list key. */
  allows: ReadonlySet<string>;
  /** Whose settings the session follows: its Project's, or, in a Chat, the Bot's. */
  owner: "project" | "bot";
  /** Changes them; null in a draft, which has no session yet and changes the Project instead. */
  editAllows: ((edit: (allow: ReadonlySet<string>) => ReadonlySet<string>) => Promise<void>) | null;
}

/** The note under a tool: on for this session only, or why the Project leaves it off. */
function noteOf(
  allowed: boolean,
  refusal: ProjectToolRefusal | null,
  owner: ProjectEdits["owner"],
): string | undefined {
  const bot = owner === "bot";
  if (allowed)
    return i18n.t(bot ? "connectors.tools.pages.onForChat" : "connectors.tools.pages.onForSession");
  if (refusal === "not-picked") return offInOwner(owner);
  if (refusal === "reads-only") {
    return i18n.t(
      bot ? "connectors.tools.pages.botReadsOnly" : "connectors.tools.pages.projectReadsOnly",
    );
  }
  return undefined;
}

/** "Off in this Project", or "Off in this Bot" for a Bot's session in a Chat. */
export function offInOwner(owner: ProjectEdits["owner"]): string {
  return owner === "bot"
    ? i18n.t("connectors.tools.pages.offInBot")
    : i18n.t("connectors.tools.pages.offInProject");
}

const ThemedSpinner = withUnistyles(LoadingSpinner, (theme) => ({
  color: theme.colors.foregroundMuted,
}));

/** A tool's kind as a row badge; the label is read when the row renders, in the current language. */
export function kindBadge(kind: ConnectorToolKind): SessionRowBadge {
  return { label: TOOL_KIND_LABELS[kind], variant: kind === "send" ? "warning" : "muted" };
}

function confirmMessage(refusal: ProjectToolRefusal): string {
  return refusal === "reads-only"
    ? i18n.t("connectors.tools.pages.confirmReadsOnly")
    : i18n.t("connectors.tools.pages.confirmNotPicked");
}

/**
 * Lets the session use a tool its Project leaves off. A running session or a Chat gets it for
 * itself, in the list the daemon keeps; a draft asks, then adds it to the Project. Either way the
 * session's own switches then keep it on.
 */
async function turnOnPastProject(input: {
  key: string;
  refusal: ProjectToolRefusal;
  title: string;
  project: ProjectEdits;
  allow: GrantEdit;
  /** The session's switches once the tool is on: it on, and the set's whole key gone. */
  keepOn: SessionOffEdit;
  apply: Apply;
}) {
  const { key, refusal, title, project, allow, keepOn, apply } = input;
  try {
    if (project.editAllows) {
      await project.editAllows((current) => new Set([...current, key]));
    } else {
      const confirmed = await confirmDialog({
        title: i18n.t("connectors.tools.common.turnOnTitle", { name: title }),
        message: confirmMessage(refusal),
        confirmLabel: i18n.t("connectors.tools.common.turnOnForProject"),
      });
      if (!confirmed) return;
      await project.save(allow);
    }
    apply(keepOn);
  } catch (cause) {
    project.onError(toErrorMessage(cause));
  }
}

/**
 * The switch of one tool. Within what the Project gives it only changes the session's off list;
 * off for a tool allowed past the Project drops the allow; on for a tool the Project leaves off
 * goes past the Project (`turnOnPastProject`).
 */
function useToolSwitch(input: {
  set: SessionToolSet;
  kept: readonly string[];
  apply: Apply;
  project: ProjectEdits;
  refusalOf(tool: string): ProjectToolRefusal | null;
  titleOf(tool: string): string;
  allow(tool: string): GrantEdit;
}) {
  const { set, kept, apply, project, refusalOf, titleOf, allow } = input;
  return useCallback(
    async (tool: string, value: boolean) => {
      const key = set.keyOf(tool);
      const allowed = project.allows.has(key);
      if (allowed && !value && project.editAllows) {
        await project
          .editAllows((current) => new Set([...current].filter((other) => other !== key)))
          .catch((cause: unknown) => project.onError(toErrorMessage(cause)));
        return;
      }
      const refusal = value && !allowed ? refusalOf(tool) : null;
      if (refusal) {
        // A whole key (the group or app off for this session) would keep the tool off too.
        const keepOn: SessionOffEdit = (current) =>
          setSessionKeptTools(current, { ...set, given: [...set.given, tool] }, [...kept, tool]);
        const title = titleOf(tool);
        await turnOnPastProject({
          key,
          refusal,
          title,
          project,
          allow: allow(tool),
          keepOn,
          apply,
        });
        return;
      }
      const next = value ? [...kept, tool] : kept.filter((other) => other !== tool);
      apply((current) => setSessionKeptTools(current, set, next));
    },
    [allow, apply, kept, project, refusalOf, set, titleOf],
  );
}

/** Every tool of the group, by what it does. */
export function GroupPage({
  entry,
  off,
  apply,
  project,
}: {
  entry: SessionToolGroup;
  off: ReadonlySet<string>;
  apply: Apply;
  project: ProjectEdits;
}) {
  const { group } = entry;
  const names = useMemo(() => group.tools.map((tool) => tool.name), [group.tools]);
  const set = useMemo(
    () => withAllows(entry.set, names, project.allows),
    [entry.set, names, project.allows],
  );
  const kept = sessionKeptTools(set, off);
  const refusalOf = useCallback(
    (tool: string): ProjectToolRefusal | null =>
      entry.set.given.includes(tool) ? null : "not-picked",
    [entry.set.given],
  );
  const titleOf = useCallback(
    (tool: string) => {
      const info = group.tools.find((candidate) => candidate.name === tool);
      return info ? agentToolDescription(info) : tool;
    },
    [group.tools],
  );
  const allow = useCallback(
    (tool: string): GrantEdit =>
      (grant) =>
        allowGroupTool(grant, group, tool, project.defaults),
    [group, project.defaults],
  );
  const toggle = useToolSwitch({ set, kept, apply, project, refusalOf, titleOf, allow });
  return (
    <View style={settingsStyles.card}>
      {group.tools.map((tool, index) => {
        const refusal = refusalOf(tool.name);
        return (
          <SessionSwitchRow
            key={tool.name}
            bordered={index > 0}
            id={tool.name}
            value={kept.includes(tool.name)}
            onToggle={toggle}
            label={agentToolDescription(tool)}
            note={noteOf(project.allows.has(set.keyOf(tool.name)), refusal, project.owner)}
            onNote={refusal ? project.manage : undefined}
            testID={`session-tool-${tool.name}`}
          >
            <Text style={settingsStyles.rowTitle}>{agentToolDescription(tool)}</Text>
            <Text style={styles.name}>{tool.name}</Text>
          </SessionSwitchRow>
        );
      })}
    </View>
  );
}

function grantedEntry(entry: SessionConnector, grant: ConnectorGrant | undefined) {
  return entry.target.kind === "app"
    ? grant?.apps?.[entry.target.slug]
    : grant?.mcpServers?.[entry.target.name];
}

/** Every tool of an app or server, as its picker in Project settings lists them. */
export function ConnectorPage({
  serverId,
  entry,
  grant,
  off,
  apply,
  project,
  query,
}: {
  serverId: string;
  entry: SessionConnector;
  grant: ConnectorGrant | undefined;
  off: ReadonlySet<string>;
  apply: Apply;
  project: ProjectEdits;
  query: string;
}) {
  const toolkit = entry.target.kind === "app" ? entry.target.slug : undefined;
  const target = useMemo(() => connectorTarget(entry), [entry]);
  const tools = useConnectorTools(serverId, target);
  const list = useMemo(() => tools.data ?? [], [tools.data]);
  const granted = grantedEntry(entry, grant);
  const refusalOf = useCallback(
    (name: string) => {
      const tool = list.find((candidate) => candidate.name === name);
      return tool ? connectorToolRefusal(tool, granted) : null;
    },
    [granted, list],
  );
  const set = useMemo<SessionToolSet>(
    () =>
      withAllows(
        {
          wholeKey: entry.key,
          keyOf: entry.toolKey,
          given: list.filter((tool) => !refusalOf(tool.name)).map((tool) => tool.name),
        },
        list.map((tool) => tool.name),
        project.allows,
      ),
    [entry, list, project.allows, refusalOf],
  );
  const titleOf = useCallback(
    (name: string) => {
      const tool = list.find((candidate) => candidate.name === name);
      return tool ? toolTitle(tool, toolkit) : name;
    },
    [list, toolkit],
  );
  const allow = useCallback(
    (name: string): GrantEdit =>
      (current) => {
        const tool = list.find((candidate) => candidate.name === name);
        if (!tool) return { ...current };
        return entry.target.kind === "app"
          ? allowAppTool(current, entry.target.slug, tool, list)
          : allowServerTool(
              current,
              entry.target.name,
              name,
              list.map((candidate) => candidate.name),
            );
      },
    [entry.target, list],
  );
  const kept = sessionKeptTools(set, off);
  const toggle = useToolSwitch({ set, kept, apply, project, refusalOf, titleOf, allow });
  const shown = useMemo(() => matchingTools(list, query, toolkit), [list, query, toolkit]);
  if (tools.isLoading) return <ThemedSpinner />;
  if (tools.error) return <Text style={settingsStyles.rowError}>{tools.error.message}</Text>;
  if (shown.length === 0) return <NoToolMatches />;
  return (
    <View style={settingsStyles.card}>
      {shown.map((tool, index) => {
        const refusal = refusalOf(tool.name);
        return (
          <SessionSwitchRow
            key={tool.name}
            id={tool.name}
            bordered={index > 0}
            badge={kindBadge(connectorToolKindOf(tool.kind))}
            value={kept.includes(tool.name)}
            onToggle={toggle}
            label={toolTitle(tool, toolkit)}
            note={noteOf(project.allows.has(set.keyOf(tool.name)), refusal, project.owner)}
            onNote={refusal ? project.manage : undefined}
            testID={`session-connector-tool-${tool.name}`}
          >
            <ToolLabel tool={tool} toolkit={toolkit} />
          </SessionSwitchRow>
        );
      })}
    </View>
  );
}

function NoToolMatches() {
  const { t } = useTranslation();
  return (
    <Text style={[settingsStyles.rowHint, styles.empty]}>
      {t("connectors.tools.pages.noMatch")}
    </Text>
  );
}

function connectorTarget(entry: SessionConnector): { app: string } | { mcpServer: string } {
  return entry.target.kind === "app"
    ? { app: entry.target.slug }
    : { mcpServer: entry.target.name };
}

function matchingTools(tools: readonly ConnectorTool[], query: string, toolkit?: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return tools;
  return tools.filter((tool) =>
    [tool.name, toolTitle(tool, toolkit), tool.description ?? ""].some((text) =>
      text.toLowerCase().includes(needle),
    ),
  );
}

const styles = StyleSheet.create((theme) => ({
  empty: { padding: theme.spacing[3] },
  name: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontFamily: theme.fontFamily.mono,
    marginTop: theme.spacing[1],
  },
}));
