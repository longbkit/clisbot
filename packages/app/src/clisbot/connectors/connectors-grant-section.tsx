import { Plus } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import { i18n } from "@/i18n/i18next";
import type { ConnectorGrant, ConnectorToolSelection } from "@clisbot/protocol/connectors/types";
import { SettingsSection } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { settingsStyles } from "@/styles/settings";
import { AddConnectorSheet, type ConnectorChoice } from "./add-connector-sheet";
import { AppGrantRow, ServerGrantRow, type GrantTarget } from "./grant-rows";
import { SendingSection } from "./grant-cards";
import { AgentToolsSections } from "./agent-tools-section";
import { AgentToolsPickerSheet } from "./agent-tools-picker-sheet";
import { disabledToolsOf, enabledToolsOf, saveGroupTools } from "./agent-tools-model";
import type { AgentToolDefaults } from "./project-grants";
import type { AgentToolGroup } from "@clisbot/protocol/connectors/agent-tools";
import { GrantSheet, type GrantPicker } from "./grant-sheet";
import { useConnectorLookup, type ConnectorLookup } from "./connector-lookup";
import { useGrantEditor, type GrantEdit } from "./use-grant-editor";
import { useHostConnectorsFeature } from "./feature";
import { isAccessDenied } from "./data";
import { useProjectGrant } from "./project-grants";
import { AccountPickerSheet } from "./account-picker-sheet";
import { grantApp, grantMcpServer, setAppAccounts, setAppTools, setMcpServerTools } from "./model";
import { ToolPickerSheet } from "./tool-picker-sheet";

/**
 * A Project's Connectors (docs/features/connectors/README.md, "Grants"): which apps and MCP
 * servers its agent sessions may use, read-only or read and write, which tools, and whether
 * sends ask first. A Bot is a Project, so Bot settings shows the same grant for quick setup.
 * Every change saves at once; the next tool call reads it.
 */

/** The sheet open over the section: adding, one Connector's settings, or one of its pickers. */
type OpenSheet =
  | { kind: "add" }
  | { kind: "agentTools"; group: AgentToolGroup }
  | { kind: "grant"; target: GrantTarget }
  | { kind: "tools"; target: GrantTarget }
  | { kind: "accounts"; target: GrantTarget };

export interface ConnectorsGrantSectionProps {
  serverId: string;
  projectId: string;
  /** Whose grant this is, for the wording: a Bot's, or a Project's agent sessions'. */
  subject: "bot" | "project";
  /**
   * The Bot's agent provider: Codex Bots also get the switch for Codex's own apps. A Project's
   * sessions can run any provider, so it always shows there.
   */
  provider?: string;
}

/** The section's wording for a Bot's grant or a Project's. */
function subjectText(subject: "bot" | "project"): { info: string; empty: string } {
  return subject === "bot"
    ? {
        info: i18n.t("connectors.screen.grantSection.botInfo"),
        empty: i18n.t("connectors.screen.grantSection.botEmpty"),
      }
    : {
        info: i18n.t("connectors.screen.grantSection.projectInfo"),
        empty: i18n.t("connectors.screen.grantSection.projectEmpty"),
      };
}

export function ConnectorsGrantSection(props: ConnectorsGrantSectionProps) {
  const { t } = useTranslation();
  const enabled = useHostConnectorsFeature(props.serverId);
  const saved = useProjectGrant(props.serverId, props.projectId, enabled);
  if (!enabled) return null;
  // Someone without the right to read Connectors (a Project-level Member) does not see them.
  if (isAccessDenied(saved.error)) return null;
  if (!saved.loaded) {
    return (
      <SettingsSection title={t("connectors.screen.common.connectors")}>
        <Text style={settingsStyles.rowHint}>
          {saved.error ? saved.error.message : t("connectors.screen.grantSection.loading")}
        </Text>
      </SettingsSection>
    );
  }
  // One editor per Project: its local copy must never carry over to another.
  return (
    <GrantEditor
      key={`${props.serverId}:${props.projectId}`}
      {...props}
      saved={saved.grant}
      defaults={saved.defaults}
      onSave={saved.save}
    />
  );
}

function GrantEditor({
  serverId,
  subject,
  provider,
  saved,
  defaults,
  onSave,
}: ConnectorsGrantSectionProps & {
  saved: ConnectorGrant | undefined;
  defaults: AgentToolDefaults | undefined;
  onSave(edit: GrantEdit): Promise<ConnectorGrant | null>;
}) {
  const { t } = useTranslation();
  const editor = useGrantEditor(saved, onSave);
  const lookup = useConnectorLookup(serverId);
  const sheets = useSheets(editor.apply, serverId, defaults);
  const apps = Object.entries(editor.grant?.apps ?? {});
  const servers = Object.entries(editor.grant?.mcpServers ?? {});
  const total = apps.length + servers.length;
  const text = subjectText(subject);
  const choices = useMemo(
    () => lookup.choices.filter((choice) => !isGranted(editor.grant, choice)),
    [editor.grant, lookup.choices],
  );
  return (
    <>
      <AgentToolsSections
        grant={editor.grant}
        defaults={defaults}
        apply={editor.apply}
        onPickGroup={sheets.openAgentTools}
      />
      <SettingsSection title={t("connectors.screen.common.connectors")} info={text.info}>
        <View style={settingsStyles.card}>
          {apps.map(([slug, app], index) => (
            <AppGrantRow
              key={slug}
              slug={slug}
              app={app}
              lookup={lookup}
              bordered={index > 0}
              apply={editor.apply}
              onOpen={sheets.openGrant}
            />
          ))}
          {servers.map(([name, server], index) => (
            <ServerGrantRow
              key={name}
              name={name}
              tools={server.tools}
              enabled={server.enabled !== false}
              bordered={apps.length + index > 0}
              apply={editor.apply}
              onOpen={sheets.openGrant}
            />
          ))}
          <AddRow
            bordered={total > 0}
            empty={total === 0 ? text.empty : null}
            onAdd={sheets.openAdd}
          />
        </View>
        {editor.error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {editor.error}
          </Text>
        ) : null}
      </SettingsSection>
      <SendingSection
        grant={editor.grant}
        apply={editor.apply}
        showSends={apps.length > 0}
        showBuiltInApps={provider === undefined || provider === "codex"}
      />
      <Sheets
        serverId={serverId}
        open={sheets.open}
        grant={editor.grant}
        lookup={lookup}
        choices={choices}
        apply={editor.apply}
        sheets={sheets}
      />
    </>
  );
}

function AddRow({
  bordered,
  empty,
  onAdd,
}: {
  bordered: boolean;
  /** The empty-state sentence, or null when something is granted. */
  empty: string | null;
  onAdd(): void;
}) {
  const { t } = useTranslation();
  return (
    <View style={bordered ? [settingsStyles.row, settingsStyles.rowBorder] : settingsStyles.row}>
      <Text style={[settingsStyles.rowHint, settingsStyles.rowContent]}>{empty ?? ""}</Text>
      <Button
        size="sm"
        variant="outline"
        leftIcon={Plus}
        onPress={onAdd}
        testID="bot-connectors-add"
      >
        {t("connectors.screen.common.addConnector")}
      </Button>
    </View>
  );
}

/** Whichever sheet is open; a picker returns to its Connector's sheet when it closes. */
function Sheets({
  serverId,
  open,
  grant,
  lookup,
  choices,
  apply,
  sheets,
}: {
  serverId: string;
  open: OpenSheet | null;
  grant: ConnectorGrant | undefined;
  lookup: ConnectorLookup;
  choices: ConnectorChoice[];
  apply(edit: GrantEdit): void;
  sheets: ReturnType<typeof useSheets>;
}) {
  if (open?.kind === "agentTools") {
    const group = open.group;
    return (
      <AgentToolsPickerSheet
        group={group}
        // The saved list, also for a browser that is off: saving it turns the browser on with it.
        initial={enabledToolsOf(group, disabledToolsOf(grant))}
        onClose={sheets.close}
        onSave={sheets.saveAgentTools}
      />
    );
  }
  if (open?.kind === "grant") {
    return (
      <GrantSheet
        target={open.target}
        grant={grant}
        lookup={lookup}
        apply={apply}
        onPick={sheets.pick}
        onManage={sheets.manage}
        onClose={sheets.close}
      />
    );
  }
  if (open?.kind === "accounts" && open.target.kind === "app") {
    const slug = open.target.slug;
    return (
      <AccountPickerSheet
        appName={lookup.name(slug)}
        accounts={lookup.accounts(slug)}
        initial={grant?.apps?.[slug]?.accounts ?? "all"}
        onClose={sheets.backToGrant}
        onSave={sheets.saveAccounts}
      />
    );
  }
  if (open?.kind === "tools") {
    return (
      <PickerSheet
        serverId={serverId}
        target={open.target}
        name={open.target.kind === "app" ? lookup.name(open.target.slug) : open.target.name}
        grant={grant}
        onClose={sheets.backToGrant}
        onSave={sheets.saveTools}
      />
    );
  }
  return (
    <AddConnectorSheet
      visible={open?.kind === "add"}
      choices={choices}
      onClose={sheets.close}
      onChoose={sheets.add}
      onManage={sheets.manage}
    />
  );
}

function isGranted(grant: ConnectorGrant | undefined, choice: ConnectorChoice): boolean {
  return choice.kind === "app"
    ? Boolean(grant?.apps?.[choice.slug])
    : Boolean(grant?.mcpServers?.[choice.name]);
}

function PickerSheet({
  serverId,
  target,
  name,
  grant,
  onClose,
  onSave,
}: {
  serverId: string;
  target: GrantTarget;
  name: string;
  grant: ConnectorGrant | undefined;
  onClose(): void;
  onSave(tools: ConnectorToolSelection): void;
}) {
  const { t } = useTranslation();
  const query = useMemo(
    () => (target.kind === "app" ? { app: target.slug } : { mcpServer: target.name }),
    [target],
  );
  const current =
    target.kind === "app"
      ? grant?.apps?.[target.slug]?.tools
      : grant?.mcpServers?.[target.name]?.tools;
  return (
    <ToolPickerSheet
      serverId={serverId}
      target={query}
      title={t("connectors.screen.grantSection.pickerTitle", { name })}
      initial={current ?? "all"}
      onClose={onClose}
      onSave={onSave}
    />
  );
}

function useSheets(
  apply: (edit: GrantEdit) => void,
  serverId: string,
  defaults: AgentToolDefaults | undefined,
) {
  const router = useRouter();
  const [open, setOpen] = useState<OpenSheet | null>(null);
  const target = open !== null && "target" in open ? open.target : null;
  const add = useCallback(
    (choice: ConnectorChoice) => {
      setOpen(null);
      apply((grant) =>
        choice.kind === "app" ? grantApp(grant, choice.slug) : grantMcpServer(grant, choice.name),
      );
    },
    [apply],
  );
  const toolsGroup = open?.kind === "agentTools" ? open.group : null;
  const saveAgentTools = useCallback(
    (enabled: string[]) => {
      setOpen(null);
      if (toolsGroup) apply((grant) => saveGroupTools(grant, toolsGroup, enabled, defaults));
    },
    [apply, defaults, toolsGroup],
  );
  const backToGrant = useCallback(() => {
    setOpen(target ? { kind: "grant", target } : null);
  }, [target]);
  const saveTools = useCallback(
    (tools: ConnectorToolSelection) => {
      backToGrant();
      if (!target) return;
      apply((grant) =>
        target.kind === "app"
          ? setAppTools(grant, target.slug, tools)
          : setMcpServerTools(grant, target.name, tools),
      );
    },
    [apply, backToGrant, target],
  );
  const saveAccounts = useCallback(
    (accounts: "all" | string[]) => {
      backToGrant();
      if (target?.kind === "app") apply((grant) => setAppAccounts(grant, target.slug, accounts));
    },
    [apply, backToGrant, target],
  );
  const manage = useCallback(() => {
    setOpen(null);
    router.push(`/connectors?serverId=${encodeURIComponent(serverId)}`);
  }, [router, serverId]);
  return {
    open,
    add,
    manage,
    backToGrant,
    saveTools,
    saveAccounts,
    saveAgentTools,
    pick: useCallback(
      (picker: GrantPicker) => setOpen(target ? { kind: picker, target } : null),
      [target],
    ),
    openAdd: useCallback(() => setOpen({ kind: "add" }), []),
    openAgentTools: useCallback(
      (group: AgentToolGroup) => setOpen({ kind: "agentTools", group }),
      [],
    ),
    openGrant: useCallback((next: GrantTarget) => setOpen({ kind: "grant", target: next }), []),
    close: useCallback(() => setOpen(null), []),
  };
}

const styles = StyleSheet.create((theme) => ({
  error: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
    marginTop: theme.spacing[2],
  },
}));
