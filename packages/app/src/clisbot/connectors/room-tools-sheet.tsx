import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useRouter } from "expo-router";
import { connectorToolKindOf, type ConnectorTool } from "@clisbot/protocol/connectors/types";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { SettingsSection } from "@/components/settings";
import { SettingsInfoTip } from "@/components/settings/headings/settings-info-tip";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { settingsStyles } from "@/styles/settings";
import { toErrorMessage } from "@/utils/error-messages";
import { AgentToolGroupIcon } from "./agent-tools-section";
import { toolCountSummary } from "./agent-tools-model";
import { ConnectorLogo } from "./connector-logo";
import { ToolLabel } from "./connector-detail-parts";
import { useConnectorLookup, type ConnectorLookup } from "./connector-lookup";
import { useConnectorTools } from "./data";
import { toolTitle } from "./model";
import { connectorToolRefusal } from "./project-allow-tool";
import { botsLabel, type RoomConnector, type RoomGroup, type RoomTools } from "./room-tools";
import {
  sessionKeptTools,
  setSessionKeptTools,
  toggled,
  type SessionOffEdit,
  type SessionToolSet,
} from "./session-connectors";
import { SessionSwitchRow } from "./session-switch-row";
import { KIND_BADGES } from "./session-tool-pages";
import { OpeningRow, SectionLink, connectorDisplay } from "./session-tools-list";

/**
 * The Tools sheet of a group chat (docs/features/connectors/README.md, "In a Chat"): the tools any
 * Bot in the room has, each with who has it, and a switch that takes it away from every Bot here.
 * It never gives a Bot something its own settings do not; those are changed in Bot settings.
 */

type Apply = (edit: SessionOffEdit) => void;
type Page =
  | { kind: "list" }
  | { kind: "group"; entry: RoomGroup }
  | { kind: "connector"; entry: RoomConnector };

const ThemedSpinner = withUnistyles(LoadingSpinner, (theme) => ({
  color: theme.colors.foregroundMuted,
}));

const ROOM_INFO =
  "Turning something off here turns it off for every Bot in this chat, Bots added later included, and it stays after /new. Each Bot's own settings still decide what it has: change those in Bot settings, and the room follows unless it turned that thing off.";

function pageOf(id: string | null, room: RoomTools): Page {
  const group = room.groups.find((entry) => `group:${entry.group.id}` === id);
  if (group) return { kind: "group", entry: group };
  const connector = room.connectors.find((entry) => `connector:${entry.key}` === id);
  return connector ? { kind: "connector", entry: connector } : { kind: "list" };
}

/** Who has a tool, when not every Bot that could does: "Only writer". */
function holdersNote(holders: readonly string[] | undefined, all: readonly string[]) {
  if (!holders || holders.length === 0) return "No Bot here has it";
  return holders.length < all.length ? `Only ${botsLabel(holders)}` : undefined;
}

export function RoomToolsSheet({
  serverId,
  room,
  off,
  update,
  onClose,
}: {
  serverId: string;
  room: RoomTools;
  off: ReadonlySet<string>;
  update(edit: SessionOffEdit): Promise<void>;
  onClose(): void;
}) {
  const lookup = useConnectorLookup(serverId);
  const router = useRouter();
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
  const allConnectors = useCallback(() => {
    onClose();
    router.push(`/connectors?serverId=${encodeURIComponent(serverId)}`);
  }, [onClose, router, serverId]);
  const page = pageOf(pageId, room);
  const header = useRoomHeader(page, lookup, back, setSearch);
  const footer = useMemo(
    () => (
      <View style={styles.footer}>
        <Button variant="default" onPress={onClose}>
          Done
        </Button>
      </View>
    ),
    [onClose],
  );
  return (
    <AdaptiveModalSheet
      key={pageId ?? "list"}
      header={header}
      visible
      onClose={onClose}
      footer={footer}
      desktopMaxWidth={520}
    >
      {page.kind === "group" ? <RoomGroupPage entry={page.entry} off={off} apply={apply} /> : null}
      {page.kind === "connector" ? (
        <RoomConnectorPage
          serverId={serverId}
          entry={page.entry}
          off={off}
          apply={apply}
          query={search}
        />
      ) : null}
      {page.kind === "list" ? (
        <RoomList
          room={room}
          lookup={lookup}
          off={off}
          apply={apply}
          onOpen={setPageId}
          onAllConnectors={allConnectors}
        />
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={[settingsStyles.rowError, styles.error]}>
          {error}
        </Text>
      ) : null}
    </AdaptiveModalSheet>
  );
}

function useRoomHeader(
  page: Page,
  lookup: ConnectorLookup,
  back: () => void,
  setSearch: (query: string) => void,
): SheetHeader {
  return useMemo(() => {
    const backTo = { onPress: back, accessibilityLabel: "Back to the room's tools" };
    if (page.kind === "group") {
      return {
        title: page.entry.group.label,
        subtitle: page.entry.group.description,
        leading: <AgentToolGroupIcon group={page.entry.group.id} />,
        back: backTo,
      };
    }
    if (page.kind === "connector") {
      const display = connectorDisplay(page.entry, page.entry.holders[0]?.grant, lookup);
      return {
        title: display.name,
        subtitle: `Used by ${botsLabel(page.entry.holders.map((holder) => holder.name))}`,
        leading: <ConnectorLogo slug={display.slug} name={display.name} logo={display.logo} />,
        back: backTo,
        search: { onChange: setSearch, placeholder: "Search tools", testID: "room-tools-search" },
      };
    }
    return {
      title: "Tools in this room",
      subtitle: "For every Bot in this group chat",
      actions: <SettingsInfoTip title="Tools in this room" info={ROOM_INFO} />,
    };
  }, [back, lookup, page, setSearch]);
}

function RoomList({
  room,
  lookup,
  off,
  apply,
  onOpen,
  onAllConnectors,
}: {
  room: RoomTools;
  lookup: ConnectorLookup;
  off: ReadonlySet<string>;
  apply: Apply;
  onOpen(page: string): void;
  onAllConnectors(): void;
}) {
  const allLink = useMemo(
    () => <SectionLink label="All connectors" onPress={onAllConnectors} />,
    [onAllConnectors],
  );
  return (
    <>
      {room.groups.length > 0 ? (
        <SettingsSection title="Clisbot tools">
          <View style={settingsStyles.card}>
            {room.groups.map((entry, index) => (
              <RoomGroupRow
                key={entry.group.id}
                entry={entry}
                bordered={index > 0}
                off={off}
                apply={apply}
                onOpen={onOpen}
              />
            ))}
          </View>
        </SettingsSection>
      ) : null}
      {room.connectors.length > 0 ? (
        <SettingsSection title="Connectors" trailing={allLink}>
          <View style={settingsStyles.card}>
            {room.connectors.map((entry, index) => (
              <RoomConnectorRow
                key={entry.key}
                entry={entry}
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
      {room.groups.length + room.connectors.length === 0 ? (
        <Text style={[settingsStyles.rowHint, styles.empty]}>
          No Bot here has tools or Connectors.
        </Text>
      ) : null}
    </>
  );
}

function RoomGroupRow({
  entry,
  bordered,
  off,
  apply,
  onOpen,
}: {
  entry: RoomGroup;
  bordered: boolean;
  off: ReadonlySet<string>;
  apply: Apply;
  onOpen(page: string): void;
}) {
  const { group, set } = entry;
  const kept = sessionKeptTools(set, off);
  const toggle = useCallback(
    (value: boolean) =>
      apply((current) => setSessionKeptTools(current, set, value ? set.given : [])),
    [apply, set],
  );
  const dimmed = kept.length === 0;
  const icon = useMemo(
    () => <AgentToolGroupIcon group={group.id} dimmed={dimmed} />,
    [dimmed, group.id],
  );
  return (
    <OpeningRow
      page={`group:${group.id}`}
      icon={icon}
      title={group.label}
      summary={`${toolCountSummary(kept.length, set.given.length)} · ${botsLabel(entry.bots)}`}
      bordered={bordered}
      on={kept.length > 0}
      onSwitch={toggle}
      onOpen={onOpen}
      testID={`room-tools-group-${group.id}`}
    />
  );
}

function RoomConnectorRow({
  entry,
  lookup,
  bordered,
  off,
  apply,
  onOpen,
}: {
  entry: RoomConnector;
  lookup: ConnectorLookup;
  bordered: boolean;
  off: ReadonlySet<string>;
  apply: Apply;
  onOpen(page: string): void;
}) {
  const change = useCallback(
    () => apply((current) => toggled(current, entry.key)),
    [apply, entry.key],
  );
  const display = connectorDisplay(entry, entry.holders[0]?.grant, lookup);
  const icon = useMemo(
    () => <ConnectorLogo slug={display.slug} name={display.name} logo={display.logo} />,
    [display.logo, display.name, display.slug],
  );
  const toolsOff = [...off].filter((key) => key.startsWith(`${entry.key}/`)).length;
  const who = botsLabel(entry.holders.map((holder) => holder.name));
  return (
    <OpeningRow
      page={`connector:${entry.key}`}
      icon={icon}
      title={display.name}
      summary={toolsOff > 0 ? `${who} · ${toolsOff} off here` : who}
      bordered={bordered}
      on={!off.has(entry.key)}
      onSwitch={change}
      onOpen={onOpen}
      testID={`room-tools-connector-${entry.key}`}
    />
  );
}

function useRoomToolSwitch(set: SessionToolSet, kept: readonly string[], apply: Apply) {
  return useCallback(
    (tool: string, value: boolean) => {
      const next = value ? [...kept, tool] : kept.filter((other) => other !== tool);
      apply((current) => setSessionKeptTools(current, set, next));
    },
    [apply, kept, set],
  );
}

function RoomGroupPage({
  entry,
  off,
  apply,
}: {
  entry: RoomGroup;
  off: ReadonlySet<string>;
  apply: Apply;
}) {
  const kept = sessionKeptTools(entry.set, off);
  const toggle = useRoomToolSwitch(entry.set, kept, apply);
  return (
    <View style={settingsStyles.card}>
      {entry.group.tools.map((tool, index) => {
        const holders = entry.holders.get(tool.name);
        return (
          <SessionSwitchRow
            key={tool.name}
            id={tool.name}
            bordered={index > 0}
            value={kept.includes(tool.name)}
            disabled={!holders}
            onToggle={holders ? toggle : undefined}
            label={tool.description}
            note={holdersNote(holders, entry.bots)}
            testID={`room-tool-${tool.name}`}
          >
            <Text style={settingsStyles.rowTitle}>{tool.description}</Text>
            <Text style={styles.name}>{tool.name}</Text>
          </SessionSwitchRow>
        );
      })}
    </View>
  );
}

/** The Bots here whose settings let them call this tool. */
function toolHolders(tool: ConnectorTool, entry: RoomConnector): string[] {
  return entry.holders
    .filter((holder) => {
      const granted =
        entry.target.kind === "app"
          ? holder.grant?.apps?.[entry.target.slug]
          : holder.grant?.mcpServers?.[entry.target.name];
      return connectorToolRefusal(tool, granted) === null;
    })
    .map((holder) => holder.name);
}

function RoomConnectorPage({
  serverId,
  entry,
  off,
  apply,
  query,
}: {
  serverId: string;
  entry: RoomConnector;
  off: ReadonlySet<string>;
  apply: Apply;
  query: string;
}) {
  const toolkit = entry.target.kind === "app" ? entry.target.slug : undefined;
  const target = useMemo(
    () =>
      entry.target.kind === "app" ? { app: entry.target.slug } : { mcpServer: entry.target.name },
    [entry.target],
  );
  const tools = useConnectorTools(serverId, target);
  const list = useMemo(() => tools.data ?? [], [tools.data]);
  const holders = useMemo(
    () => new Map(list.map((tool) => [tool.name, toolHolders(tool, entry)])),
    [entry, list],
  );
  const set = useMemo<SessionToolSet>(
    () => ({
      wholeKey: entry.key,
      keyOf: entry.toolKey,
      given: list
        .filter((tool) => (holders.get(tool.name)?.length ?? 0) > 0)
        .map((tool) => tool.name),
    }),
    [entry, holders, list],
  );
  const kept = sessionKeptTools(set, off);
  const toggle = useRoomToolSwitch(set, kept, apply);
  const all = useMemo(() => entry.holders.map((holder) => holder.name), [entry.holders]);
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? list.filter((tool) =>
        [tool.name, toolTitle(tool, toolkit), tool.description ?? ""].some((text) =>
          text.toLowerCase().includes(needle),
        ),
      )
    : list;
  if (tools.isLoading) return <ThemedSpinner />;
  if (tools.error) return <Text style={settingsStyles.rowError}>{tools.error.message}</Text>;
  return (
    <View style={settingsStyles.card}>
      {shown.map((tool, index) => {
        const who = holders.get(tool.name) ?? [];
        return (
          <SessionSwitchRow
            key={tool.name}
            id={tool.name}
            bordered={index > 0}
            badge={KIND_BADGES[connectorToolKindOf(tool.kind)]}
            value={kept.includes(tool.name)}
            disabled={who.length === 0}
            onToggle={who.length > 0 ? toggle : undefined}
            label={toolTitle(tool, toolkit)}
            note={holdersNote(who, all)}
            testID={`room-connector-tool-${tool.name}`}
          >
            <ToolLabel tool={tool} toolkit={toolkit} />
          </SessionSwitchRow>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  error: { marginTop: theme.spacing[3] },
  empty: { padding: theme.spacing[3] },
  name: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontFamily: theme.fontFamily.mono,
    marginTop: theme.spacing[1],
  },
  footer: { flexDirection: "row", justifyContent: "flex-end", width: "100%" },
}));
