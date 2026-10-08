import type { TFunction } from "i18next";
import { Settings2 } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useRouter, type Href } from "expo-router";
import type { ConnectorGrant } from "@clisbot/protocol/connectors/types";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { SettingsInfoTip } from "@/components/settings/headings/settings-info-tip";
import { Button } from "@/components/ui/button";
import { settingsStyles } from "@/styles/settings";
import { buildProjectSettingsRoute } from "@/utils/host-routes";
import { buildHostBotRoute } from "@/clisbot/bots/routes";
import { toErrorMessage } from "@/utils/error-messages";
import { AgentToolGroupIcon } from "./agent-tools-section";
import { agentToolGroupDescription, agentToolGroupLabel } from "./agent-tool-copy";
import { ConnectorLogo } from "./connector-logo";
import { useConnectorLookup, type ConnectorLookup } from "./connector-lookup";
import { TOOLS_VIEW_QUERY } from "./connectors-tab";
import { setSessionKeptTools, type SessionOffEdit } from "./session-connectors";
import {
  SKILLS_PAGE,
  SkillsPage,
  SkillsSection,
  skillsInfo,
  skillsPageHeader,
  useSessionSkills,
  type SessionSkills,
} from "./session-skills";
import { ConnectorPage, GroupPage, type ProjectEdits } from "./session-tool-pages";
import type { AgentToolDefaults } from "./agent-tools-model";
import type { GrantEdit } from "./use-grant-editor";
import { editSessionAllows, useSessionAllows, type AllowsOwner } from "./project-grants";
import { ListPage, connectorDisplay, connectorPage, groupPage } from "./session-tools-list";
import type { SessionConnector, SessionToolGroup, SessionTools } from "./session-tools";

/**
 * The composer's Tools sheet: the Project's tool groups and Connectors, each with a switch for this
 * session and a page listing its tools with a switch per tool, as Project settings lists them; then
 * the session's skills. Each page is its own mount, so it opens at its top.
 */

type Apply = (edit: SessionOffEdit) => void;

/** The Bot a Chat's composer acts for: the sheet names it and edits that Bot's settings. */
export interface SheetScope {
  botId: string;
  botName: string;
  group: boolean;
}

type Page =
  | { kind: "list" }
  | { kind: "group"; entry: SessionToolGroup }
  | { kind: "connector"; entry: SessionConnector }
  | { kind: "skills" };

function pageOf(id: string | null, tools: SessionTools, skills: SessionSkills): Page {
  const group = tools.groups.find((entry) => groupPage(entry.group.id) === id);
  if (group) return { kind: "group", entry: group };
  const connector = tools.connectors.find((entry) => connectorPage(entry.key) === id);
  if (connector) return { kind: "connector", entry: connector };
  if (id === SKILLS_PAGE && skills.skills !== null) return { kind: "skills" };
  return { kind: "list" };
}

export function SessionToolsSheet({
  serverId,
  projectId,
  grant,
  tools,
  off,
  update,
  agentId,
  allowsOwner,
  defaults,
  saveGrant,
  scope = null,
  onClose,
}: {
  serverId: string;
  projectId: string;
  grant: ConnectorGrant | undefined;
  defaults: AgentToolDefaults | undefined;
  /** Changes the Project's grant, for a tool the Project leaves off and the person turns on. */
  saveGrant(edit: GrantEdit): Promise<unknown>;
  scope?: SheetScope | null;
  tools: SessionTools;
  off: ReadonlySet<string>;
  update(edit: SessionOffEdit): Promise<void>;
  /** The running session, or null in a draft. */
  agentId: string | null;
  /** Whose allows the switches write: the session's, or the Chat's; null in a draft. */
  allowsOwner: AllowsOwner | null;
  onClose(): void;
}) {
  const lookup = useConnectorLookup(serverId);
  const skills = useSessionSkills(serverId, agentId, off);
  const [error, setError] = useState<string | null>(null);
  const [pageId, setPageId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const apply = useCallback<Apply>(
    (edit) => {
      setError(null);
      update(edit).catch((cause: unknown) => setError(toErrorMessage(cause)));
    },
    [update],
  );
  const back = useCallback(() => {
    setPageId(null);
    setSearch("");
  }, []);
  const page = useMemo(() => pageOf(pageId, tools, skills), [pageId, skills, tools]);
  const nav = useSheetNavigation({ serverId, projectId, botId: scope?.botId ?? null, onClose });
  const allows = useSessionAllows(serverId, allowsOwner);
  const project = useMemo<ProjectEdits>(
    () => ({
      defaults,
      save: saveGrant,
      manage: nav.manage,
      onError: setError,
      allows,
      owner: scope ? "bot" : "project",
      editAllows: allowsOwner ? (edit) => editSessionAllows(serverId, allowsOwner, edit) : null,
    }),
    [allows, allowsOwner, defaults, nav.manage, saveGrant, scope, serverId],
  );
  const header = useSheetHeader({
    page,
    grant,
    lookup,
    skills,
    running: agentId !== null,
    scope,
    back,
    setSearch,
  });
  const footer = useSheetFooter({ page, apply, nav, onClose });
  return (
    <AdaptiveModalSheet
      key={pageId ?? "list"}
      header={header}
      visible
      onClose={onClose}
      footer={footer}
      desktopMaxWidth={520}
    >
      {page.kind === "group" ? (
        <GroupPage entry={page.entry} off={off} apply={apply} project={project} />
      ) : null}
      {page.kind === "connector" ? (
        <ConnectorPage
          serverId={serverId}
          entry={page.entry}
          grant={grant}
          off={off}
          apply={apply}
          project={project}
          query={search}
        />
      ) : null}
      {page.kind === "skills" ? (
        <SkillsPage skills={skills} query={search} off={off} apply={apply} />
      ) : null}
      {page.kind === "list" ? (
        <>
          <ListPage
            tools={tools}
            grant={grant}
            lookup={lookup}
            off={off}
            apply={apply}
            onOpen={setPageId}
            onAllConnectors={nav.allConnectors}
            project={project}
          />
          <SkillsSection skills={skills} off={off} onOpen={setPageId} />
        </>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={[settingsStyles.rowError, styles.error]}>
          {error}
        </Text>
      ) : null}
    </AdaptiveModalSheet>
  );
}

/**
 * Where the sheet's links go: the Tools tab of the Project's settings, or of the Bot's when the
 * session is a Bot's; and the Host's Connectors page.
 */
function useSheetNavigation(input: {
  serverId: string;
  projectId: string;
  botId: string | null;
  onClose(): void;
}) {
  const { serverId, projectId, botId, onClose } = input;
  const router = useRouter();
  const manage = useCallback(() => {
    onClose();
    const settings: string = botId
      ? buildHostBotRoute(serverId, botId)
      : buildProjectSettingsRoute(serverId, projectId);
    router.push(`${settings}?${TOOLS_VIEW_QUERY}` as Href);
  }, [botId, onClose, projectId, router, serverId]);
  const allConnectors = useCallback(() => {
    onClose();
    router.push(`/connectors?serverId=${encodeURIComponent(serverId)}`);
  }, [onClose, router, serverId]);
  return { manage, allConnectors };
}

// The explanation is the header's info tip, not a paragraph above the card (design.md §7).
function useSheetHeader(input: {
  page: Page;
  grant: ConnectorGrant | undefined;
  lookup: ConnectorLookup;
  skills: SessionSkills;
  running: boolean;
  scope: SheetScope | null;
  back(): void;
  setSearch(query: string): void;
}): SheetHeader {
  const { page, grant, lookup, skills, running, scope, back, setSearch } = input;
  const { t } = useTranslation();
  return useMemo(() => {
    const backTo = { onPress: back, accessibilityLabel: t("connectors.tools.sheet.backToTools") };
    if (page.kind === "skills") {
      const header = skillsPageHeader();
      return {
        ...header,
        back: backTo,
        actions: <SettingsInfoTip title={header.title} info={skillsInfo(skills.switchable)} />,
        search: {
          onChange: setSearch,
          placeholder: t("connectors.tools.skills.search"),
          testID: "session-skills-search",
        },
      };
    }
    if (page.kind === "group") {
      const { group } = page.entry;
      return {
        title: agentToolGroupLabel(group),
        subtitle: agentToolGroupDescription(group),
        leading: <AgentToolGroupIcon group={group.id} />,
        back: backTo,
      };
    }
    if (page.kind === "connector") {
      const display = connectorDisplay(page.entry, grant, lookup);
      return {
        title: display.name,
        subtitle: display.summary,
        leading: <ConnectorLogo slug={display.slug} name={display.name} logo={display.logo} />,
        back: backTo,
        search: {
          onChange: setSearch,
          placeholder: t("connectors.tools.common.searchTools"),
          testID: "session-tools-search",
        },
      };
    }
    return listHeader(running, scope, t);
  }, [back, grant, lookup, page, running, scope, setSearch, skills.switchable, t]);
}

/** The first page's header: this session, or the picked Bot in this Chat. */
function listHeader(running: boolean, scope: SheetScope | null, t: TFunction): SheetHeader {
  const when = running
    ? t("connectors.tools.sheet.whenRunning")
    : t("connectors.tools.sheet.whenDraft");
  if (!scope) {
    const title = t("connectors.tools.sheet.title");
    const info = t("connectors.tools.sheet.projectInfo", { when });
    return { title, actions: <SettingsInfoTip title={title} info={info} /> };
  }
  const bot = scope.botName;
  const title = t("connectors.tools.sheet.botTitle", { bot });
  const info = scope.group
    ? t("connectors.tools.sheet.botInfoGroup", { when, bot })
    : t("connectors.tools.sheet.botInfo", { when, bot });
  return {
    title,
    subtitle: scope.group
      ? t("connectors.tools.sheet.inGroupChat")
      : t("connectors.tools.sheet.inChat"),
    actions: <SettingsInfoTip title={title} info={info} />,
  };
}

function useSheetFooter(input: {
  page: Page;
  apply: Apply;
  nav: { manage(): void };
  onClose(): void;
}) {
  const { page, apply, nav, onClose } = input;
  const { t } = useTranslation();
  const group = page.kind === "group" ? page.entry : null;
  const setAll = useCallback(
    (on: boolean) => {
      if (group) apply((off) => setSessionKeptTools(off, group.set, on ? group.set.given : []));
    },
    [apply, group],
  );
  const all = useCallback(() => setAll(true), [setAll]);
  const none = useCallback(() => setAll(false), [setAll]);
  return useMemo(
    () => (
      <View style={styles.footer}>
        {page.kind === "group" ? (
          <View style={styles.footerGroup}>
            <Button variant="ghost" size="sm" onPress={all}>
              {t("connectors.tools.common.all")}
            </Button>
            <Button variant="ghost" size="sm" onPress={none}>
              {t("connectors.tools.common.none")}
            </Button>
          </View>
        ) : null}
        {page.kind === "list" ? (
          <Button
            variant="outline"
            size="sm"
            leftIcon={Settings2}
            onPress={nav.manage}
            testID="composer-connectors-edit"
          >
            {t("connectors.tools.sheet.manage")}
          </Button>
        ) : null}
        {page.kind === "connector" || page.kind === "skills" ? <View /> : null}
        <Button variant="default" onPress={onClose}>
          {t("connectors.tools.common.done")}
        </Button>
      </View>
    ),
    [all, nav.manage, none, onClose, page.kind, t],
  );
}

const styles = StyleSheet.create((theme) => ({
  error: { marginTop: theme.spacing[3] },
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: theme.spacing[2],
    width: "100%",
  },
  footerGroup: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
}));
