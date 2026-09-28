import { SettingsSection } from "@/components/settings";
import { GroupChatSettings } from "./group-chat-settings";
import { ConversationProjectActions } from "./conversation-project-actions";
import { useChatOptionsState } from "./chat-options-context";
import { Ellipsis, FileText, FileDiff, MessageSquare } from "lucide-react-native";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { View, Text } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { ChatPayload } from "@getpaseo/protocol/chats/types";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { ChatParticipantSettings } from "./chat-participant-settings";
import { buildHostBotRoute } from "../routes";
import { useResourcePins } from "../sidebar/pins";
import type { BotPayload } from "../data/contracts";
import { refreshBotsAndChats } from "../data/runtime";
import {
  chatResourceActions,
  type ChatResourceAction,
  type ChatResourceActionId,
} from "./chat-resource-actions";
import { GROUP_SETTINGS_PANEL } from "./chat-panel-param";
import { useArchiveChat } from "./use-archive-chat";

import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSubTrigger,
  DropdownMenuSeparator,
  DropdownMenuHint,
} from "@/components/ui/dropdown-menu";
import { MenuTextField, type MenuTriggerState } from "@/components/ui/menu";
import { useIsCompactFormFactor } from "@/constants/layout";
import { iconButtonChromeStyle, mutedIconColorMapping } from "@/components/ui/icon-button-chrome";
import { useConversationTabsContext } from "./conversation-tabs-context";
import { ConversationSourceLabelsContext } from "./conversation-source-labels";
import { useConversationDraftContext } from "./conversation-draft-context";
import { useConversationProjectContext } from "./conversation-project-context";
import { buildConversationTabOptions, filterConversationTabs } from "./conversation-tab-options";

const ThemedEllipsis = withUnistyles(Ellipsis);
const ThemedMessageSquare = withUnistyles(MessageSquare);
const ThemedFileText = withUnistyles(FileText);
const ThemedFileDiff = withUnistyles(FileDiff);
const TAB_MESSAGE_ICON = <ThemedMessageSquare size={16} uniProps={mutedIconColorMapping} />;
const TAB_FILE_ICON = <ThemedFileText size={16} uniProps={mutedIconColorMapping} />;
const TAB_DIFF_ICON = <ThemedFileDiff size={16} uniProps={mutedIconColorMapping} />;

export function ChatOptions({
  serverId,
  chat,
  bots,
}: {
  serverId: string;
  chat: ChatPayload;
  bots: BotPayload[];
}) {
  const active = useRetainedPanelActive();
  const compact = useIsCompactFormFactor();
  const triggerStyle = useCallback(
    (state: MenuTriggerState) =>
      iconButtonChromeStyle({ size: "large", state, style: compact && styles.touchTarget }),
    [compact],
  );
  const client = useHostRuntimeClient(serverId);
  const router = useRouter();
  const { visible, setVisible } = useChatOptionsState();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [details, setDetails] = useState<"participants" | "project" | null>(null);
  const tabs = useConversationTabsContext();
  const labels = useContext(ConversationSourceLabelsContext);
  const draft = useConversationDraftContext();
  const project = useConversationProjectContext();
  const group = chat.kind === "group" || (!chat.kind && chat.participants.length > 1);
  const tabOptions = useMemo(
    () => buildConversationTabOptions(tabs?.tabs ?? [], labels, group),
    [tabs?.tabs, labels, group],
  );
  const pinChats = useMemo(() => [{ ...chat, serverId }], [chat, serverId]);
  const { toggle: togglePin, isPinned } = useResourcePins(pinChats);
  const pin = useMemo(
    () => ({ kind: "chat" as const, serverId, id: chat.id }),
    [serverId, chat.id],
  );
  const pinned = isPinned(pin);
  const changePin = useCallback(() => togglePin(pin), [togglePin, pin]);
  const close = useCallback(() => {
    setVisible(false);
    setDetails(null);
    setError(null);
  }, [setVisible]);
  useEffect(() => {
    if (!active) close();
  }, [active, close]);
  const directBot = !group ? bots.find((bot) => bot.id === chat.participants[0]?.botId) : undefined;
  const configureBot = useCallback(() => {
    if (!directBot?.canConfigure) return;
    close();
    router.push(buildHostBotRoute(serverId, directBot.id));
  }, [directBot, close, router, serverId]);
  const header = useMemo(
    () => ({ title: details === "project" ? "Project" : "Group settings" }),
    [details],
  );
  const toggleParticipant = useCallback(
    async (botId: string) => {
      if (!client || busy) return;
      setBusy(true);
      setError(null);
      try {
        const exists = chat.participants.some((p) => p.botId === botId);
        if (exists && chat.participants.length === 1)
          throw new Error("A chat needs at least one bot");
        const r = exists
          ? await client.removeChatParticipant({ chatId: chat.id, botId })
          : await client.addChatParticipant({ chatId: chat.id, botId });
        if (r.error) throw new Error(r.error);
        refreshBotsAndChats();
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
    },
    [busy, chat, client],
  );
  const archiveChat = useArchiveChat();
  const archive = useCallback(async () => {
    if (!client || busy) return;
    setBusy(true);
    setError(null);
    try {
      await archiveChat(serverId, chat.id);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [archiveChat, busy, chat.id, client, serverId]);
  const openParticipants = useCallback(() => setDetails("participants"), []);
  useGroupSettingsPanel(group, openParticipants);
  const resourceActions = useMemo(
    () =>
      chatResourceActions({
        target: group ? "group" : "direct",
        pinned,
        canConfigureBot: directBot?.canConfigure,
      }),
    [group, pinned, directBot?.canConfigure],
  );
  const runAction = useCallback(
    (id: ChatResourceActionId) => {
      if (id === "pin") return changePin();
      if (id === "bot-settings") return configureBot();
      if (id === "group-settings") return openParticipants();
      void archive();
    },
    [archive, changePin, configureBot, openParticipants],
  );
  const archiveAction = resourceActions.find((action) => action.id === "archive");
  const openProject = useCallback(() => setDetails("project"), []);
  const pages = useMemo(
    () => [
      {
        id: "tabs",
        title: "Switch tab",
        hoverIntent: false,
        content: (
          <ChatTabsPage options={tabOptions} activeId={tabs?.activeId} onSelect={tabs?.selectTab} />
        ),
      },
      {
        id: "fresh",
        title: "Start a fresh session",
        hoverIntent: false,
        content: (
          <>
            <DropdownMenuHint>
              Send /new in Messages to reset bot context. This chat’s history stays here.
            </DropdownMenuHint>
            <DropdownMenuItem disabled={!draft} onSelect={draft?.focusMessages}>
              Go to Messages
            </DropdownMenuItem>
          </>
        ),
      },
    ],
    [tabOptions, tabs, draft],
  );
  return (
    <>
      <DropdownMenu compactMode="sheet" open={visible} onOpenChange={setVisible}>
        <DropdownMenuTrigger
          accessibilityLabel="Chat options"
          testID="chat-options-trigger"
          style={triggerStyle}
        >
          <ThemedEllipsis size={18} uniProps={mutedIconColorMapping} />
        </DropdownMenuTrigger>
        <DropdownMenuContent sheetTitle="Chat options" align="end" width={280} pages={pages}>
          <DropdownMenuSubTrigger
            id="tabs"
            disabled={!tabOptions.length}
            value={String(tabOptions.length)}
          >
            Switch tab
          </DropdownMenuSubTrigger>
          <DropdownMenuSeparator />
          {resourceActions
            .filter((action) => action.id !== "archive")
            .map((action) => (
              <ResourceActionItem key={action.id} action={action} onSelect={runAction} />
            ))}
          {project ? (
            <DropdownMenuItem onSelect={openProject}>Project actions</DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuSubTrigger id="fresh">Start a fresh session</DropdownMenuSubTrigger>
          {archiveAction ? (
            <ResourceActionItem
              action={archiveAction}
              onSelect={runAction}
              disabled={busy || !client}
            />
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <AdaptiveModalSheet
        visible={active && (details !== null || error !== null)}
        header={header}
        onClose={close}
      >
        {active ? (
          <View style={styles.body}>
            {details === "project" && project ? (
              <ConversationProjectActions project={project} onChoose={close} />
            ) : null}
            {details === "participants" && group ? (
              <>
                <SettingsSection title="Name and replies" flush>
                  <GroupChatSettings
                    key={chat.id}
                    serverId={serverId}
                    chat={chat}
                    onSaved={close}
                  />
                </SettingsSection>
                <Text style={styles.text}>Participant changes apply immediately.</Text>
                <ChatParticipantSettings
                  chat={chat}
                  bots={bots}
                  busy={busy || !client}
                  toggle={toggleParticipant}
                />
              </>
            ) : null}
            {error ? (
              <Text accessibilityRole="alert" style={styles.text}>
                {error}
              </Text>
            ) : null}
          </View>
        ) : null}
      </AdaptiveModalSheet>
    </>
  );
}

function ResourceActionItem({
  action,
  onSelect,
  disabled,
}: {
  action: ChatResourceAction;
  onSelect: (id: ChatResourceActionId) => void;
  disabled?: boolean;
}) {
  const select = useCallback(() => onSelect(action.id), [action.id, onSelect]);
  return (
    <DropdownMenuItem disabled={disabled} onSelect={select}>
      {action.label}
    </DropdownMenuItem>
  );
}

/** Opens Group settings once when the route asks for it (`?panel=group-settings`). */
function useGroupSettingsPanel(group: boolean, open: () => void) {
  const { panel } = useLocalSearchParams<{ panel?: string }>();
  const router = useRouter();
  const { setVisible } = useChatOptionsState();
  useEffect(() => {
    if (panel !== GROUP_SETTINGS_PANEL || !group) return;
    setVisible(false);
    open();
    router.setParams({ panel: undefined });
  }, [panel, group, open, router, setVisible]);
}

function ChatTabsPage({
  options,
  activeId,
  onSelect,
}: {
  options: ReturnType<typeof buildConversationTabOptions>;
  activeId?: string;
  onSelect?: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const matches = filterConversationTabs(options, query);
  return (
    <>
      <View style={styles.tabSearch}>
        <MenuTextField placeholder="Search tabs" onChangeText={setQuery} />
      </View>
      {matches.map((tab) => (
        <ChatTabItem key={tab.id} tab={tab} selected={tab.id === activeId} onSelect={onSelect} />
      ))}
      {!matches.length ? <DropdownMenuHint>No matching tabs</DropdownMenuHint> : null}
    </>
  );
}

function ChatTabItem({
  tab,
  selected,
  onSelect,
}: {
  tab: ReturnType<typeof buildConversationTabOptions>[number];
  selected: boolean;
  onSelect?: (id: string) => void;
}) {
  const select = useCallback(() => onSelect?.(tab.id), [onSelect, tab.id]);
  let icon = TAB_DIFF_ICON;
  if (tab.kind === "conversation") icon = TAB_MESSAGE_ICON;
  if (tab.kind === "file") icon = TAB_FILE_ICON;
  return (
    <DropdownMenuItem
      selected={selected}
      description={tab.description}
      onSelect={select}
      leading={icon}
    >
      {tab.label}
    </DropdownMenuItem>
  );
}

const styles = StyleSheet.create((theme) => ({
  touchTarget: { width: 44, height: 44 },
  body: { gap: theme.spacing[3] },
  tabSearch: {
    paddingHorizontal: theme.spacing[2],
    paddingTop: theme.spacing[1],
    paddingBottom: theme.spacing[2],
  },
  text: { color: theme.colors.foreground },
}));
