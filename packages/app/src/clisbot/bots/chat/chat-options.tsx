import { ConversationProjectActions } from "./conversation-project-actions";
import { useChatOptionsState } from "./chat-options-context";
import { Ellipsis, FileText, FileDiff, MessageSquare } from "lucide-react-native";
import { useCallback, useContext, useMemo, useState } from "react";
import { View, Text } from "react-native";
import { useRouter } from "expo-router";
import type { ChatPayload } from "@getpaseo/protocol/chats/types";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { buildHostRootRoute } from "@/utils/host-routes";
import { SettingsCard, SettingsRow, SettingsSection } from "@/components/settings";
import { ChatParticipantSettings } from "./chat-participant-settings";
import { buildHostBotRoute } from "../routes";
import { useResourcePins, pinKey } from "../sidebar/pins";
import type { BotPayload } from "../data/contracts";
import { refreshBotsAndChats } from "../data/runtime";

import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSubTrigger,
  DropdownMenuSeparator,
  DropdownMenuHint,
  type DropdownMenuTriggerProps,
} from "@/components/ui/dropdown-menu";
import { MenuTextField } from "@/components/ui/menu";
import { iconButtonChromeStyle, mutedIconColorMapping } from "@/components/ui/icon-button-chrome";
import { confirmDialog } from "@/utils/confirm-dialog";
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
  const { pins, toggle: togglePin } = useResourcePins();
  const pin = useMemo(
    () => ({ kind: "chat" as const, serverId, id: chat.id }),
    [serverId, chat.id],
  );
  const pinned = pins.some((p) => pinKey(p) === pinKey(pin));
  const changePin = useCallback(() => togglePin(pin), [togglePin, pin]);
  const close = useCallback(() => {
    setVisible(false);
    setDetails(null);
    setError(null);
  }, [setVisible]);
  const directBot = !group ? bots.find((bot) => bot.id === chat.participants[0]?.botId) : undefined;
  const configureBot = useCallback(() => {
    if (!directBot?.canConfigure) return;
    close();
    router.push(buildHostBotRoute(serverId, directBot.id));
  }, [directBot, close, router, serverId]);
  const header = useMemo(
    () => ({ title: details === "project" ? "Project" : "Participants and replies" }),
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
  const archive = useCallback(async () => {
    if (!client || busy) return;
    if (
      !(await confirmDialog({
        title: "Archive this chat?",
        message: "It will leave the active list. The transcript is kept.",
        confirmLabel: "Archive chat",
        destructive: true,
      }))
    )
      return;
    setBusy(true);
    setError(null);
    try {
      const r = await client.archiveChat({ chatId: chat.id });
      if (r.error) throw new Error(r.error);
      refreshBotsAndChats();
      router.replace(buildHostRootRoute(serverId));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [busy, chat.id, client, router, serverId]);
  const openParticipants = useCallback(() => setDetails("participants"), []);
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
          hitSlop={HEADER_ACTION_HIT_SLOP}
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
          <DropdownMenuItem onSelect={changePin}>
            {pinned ? "Unpin chat" : "Pin chat"}
          </DropdownMenuItem>
          {directBot?.canConfigure ? (
            <DropdownMenuItem onSelect={configureBot}>Bot settings</DropdownMenuItem>
          ) : null}
          {group ? (
            <DropdownMenuItem onSelect={openParticipants}>
              Participants and replies
            </DropdownMenuItem>
          ) : null}
          {project ? (
            <DropdownMenuItem onSelect={openProject}>Project actions</DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuSubTrigger id="fresh">Start a fresh session</DropdownMenuSubTrigger>
          <DropdownMenuItem disabled={busy || !client} onSelect={archive}>
            Archive chat…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AdaptiveModalSheet
        visible={details !== null || error !== null}
        header={header}
        onClose={close}
      >
        <View style={styles.body}>
          {details === "project" && project ? (
            <ConversationProjectActions project={project} onChoose={close} />
          ) : null}
          {details === "participants" && group ? (
            <>
              <ChatParticipantSettings
                chat={chat}
                bots={bots}
                busy={busy || !client}
                toggle={toggleParticipant}
              />
              <SettingsSection title="Replies" flush>
                <SettingsCard>
                  <SettingsRow
                    label={
                      chat.rules.interaction?.requireMention
                        ? "Only mentioned bots reply"
                        : "All bots reply unless you @mention one"
                    }
                    hint="Set when this chat was created. Use @mentions to direct your next message."
                  />
                </SettingsCard>
              </SettingsSection>
            </>
          ) : null}
          {error ? (
            <Text accessibilityRole="alert" style={styles.text}>
              {error}
            </Text>
          ) : null}
        </View>
      </AdaptiveModalSheet>
    </>
  );
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

const triggerStyle: DropdownMenuTriggerProps["style"] = (state) =>
  iconButtonChromeStyle({ size: "large", state });

const HEADER_ACTION_HIT_SLOP = { top: 8, bottom: 8 };

const styles = StyleSheet.create((theme) => ({
  body: { gap: theme.spacing[3] },
  tabSearch: {
    paddingHorizontal: theme.spacing[2],
    paddingTop: theme.spacing[1],
    paddingBottom: theme.spacing[2],
  },
  text: { color: theme.colors.foreground },
}));
