import { useChatOptionsState } from "./chat-options-context";
import { Ellipsis } from "lucide-react-native";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useCallback, useEffect, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import type { ChatPayload } from "@clisbot/protocol/chats/types";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { BotPayload } from "../data/contracts";
import type { ChatResourceAction, ChatResourceActionId } from "./chat-resource-actions";
import { GROUP_SETTINGS_PANEL, MEMBERS_PANEL } from "./chat-panel-param";
import {
  FRESH_SESSION_ICON,
  PROJECT_ACTIONS_ICON,
  SWITCH_TAB_ICON,
  resourceActionIcon,
} from "./chat-resource-icons";
import { isGroupChat } from "./chat-kind";
import { ChatOptionsDetailsSheet, type ChatOptionsDetail } from "./chat-options-details";
import { useChatOptionsPages } from "./chat-options-pages";
import { useChatMembership, useChatResourceMenu } from "./use-chat-options-actions";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSubTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import type { MenuTriggerState } from "@/components/ui/menu";
import { useIsCompactFormFactor } from "@/constants/layout";
import {
  iconButtonChromeGlyphSize,
  iconButtonChromeStyle,
  extraMutedIconColorMapping,
} from "@/components/ui/icon-button-chrome";
import { useConversationProjectContext } from "./conversation-project-context";

const ThemedEllipsis = withUnistyles(Ellipsis);

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
  const { setVisible } = useChatOptionsState();
  const [detail, setDetail] = useState<ChatOptionsDetail>(null);
  const group = isGroupChat(chat);
  const membership = useChatMembership(serverId, chat);
  const { setError } = membership;
  const close = useCallback(() => {
    setVisible(false);
    setDetail(null);
    setError(null);
  }, [setVisible, setError]);
  useEffect(() => {
    if (!active) close();
  }, [active, close]);
  const openGroupSettings = useCallback(() => setDetail("group-settings"), []);
  const openMembers = useCallback(() => setDetail("members"), []);
  const openProject = useCallback(() => setDetail("project"), []);
  useChatPanelParam(group, setDetail);
  const { actions, runAction } = useChatResourceMenu({
    serverId,
    chat,
    bots,
    group,
    close,
    openGroupSettings,
    openMembers,
    archive: membership.archive,
  });
  const busy = membership.busy || !membership.connected;
  return (
    <>
      <ChatOptionsMenu
        group={group}
        actions={actions}
        onAction={runAction}
        onOpenProject={openProject}
        archiveDisabled={busy}
      />
      <ChatOptionsDetailsSheet
        active={active}
        detail={detail}
        error={membership.error}
        serverId={serverId}
        chat={chat}
        bots={bots}
        group={group}
        offline={!membership.connected}
        toggleParticipant={membership.toggleParticipant}
        onClose={close}
      />
    </>
  );
}

/**
 * The trigger and the menu: tabs; the chat's settings, Members and channel; Project actions; then
 * a fresh session, Pin and Archive, as the sidebar row's menu ends.
 */
function ChatOptionsMenu({
  group,
  actions,
  onAction,
  onOpenProject,
  archiveDisabled,
}: {
  group: boolean;
  actions: readonly ChatResourceAction[];
  onAction: (id: ChatResourceActionId) => void;
  onOpenProject: () => void;
  archiveDisabled: boolean;
}) {
  const { t } = useTranslation();
  const compact = useIsCompactFormFactor();
  const triggerStyle = useCallback(
    (state: MenuTriggerState) =>
      iconButtonChromeStyle({ size: "large", state, style: compact && styles.touchTarget }),
    [compact],
  );
  const { visible, setVisible } = useChatOptionsState();
  const project = useConversationProjectContext();
  const { pages, tabCount } = useChatOptionsPages(group);
  const archiveAction = actions.find((action) => action.id === "archive");
  const pinAction = actions.find((action) => action.id === "pin");
  const middle = actions.filter((action) => action.id !== "archive" && action.id !== "pin");
  return (
    <DropdownMenu compactMode="sheet" open={visible} onOpenChange={setVisible}>
      <DropdownMenuTrigger
        accessibilityLabel={t("bots.chat.options.title")}
        testID="chat-options-trigger"
        style={triggerStyle}
      >
        <ThemedEllipsis
          size={iconButtonChromeGlyphSize("large")}
          uniProps={extraMutedIconColorMapping}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        sheetTitle={t("bots.chat.options.title")}
        align="start"
        width={280}
        pages={pages}
      >
        <DropdownMenuSubTrigger
          id="tabs"
          disabled={!tabCount}
          value={String(tabCount)}
          leading={SWITCH_TAB_ICON}
        >
          {t("bots.chat.options.switchTab")}
        </DropdownMenuSubTrigger>
        <DropdownMenuSeparator />
        {middle.map((action) => (
          <ResourceActionItem key={action.id} action={action} onSelect={onAction} />
        ))}
        {project ? (
          <DropdownMenuItem onSelect={onOpenProject} leading={PROJECT_ACTIONS_ICON}>
            {t("bots.chat.options.projectActions")}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuSubTrigger id="fresh" leading={FRESH_SESSION_ICON}>
          {t("bots.chat.options.freshSession")}
        </DropdownMenuSubTrigger>
        {pinAction ? <ResourceActionItem action={pinAction} onSelect={onAction} /> : null}
        {archiveAction ? (
          <ResourceActionItem
            action={archiveAction}
            onSelect={onAction}
            disabled={archiveDisabled}
          />
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
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
    <DropdownMenuItem disabled={disabled} onSelect={select} leading={resourceActionIcon(action)}>
      {action.label}
    </DropdownMenuItem>
  );
}

const PANEL_DETAILS: Record<string, ChatOptionsDetail> = {
  [GROUP_SETTINGS_PANEL]: "group-settings",
  [MEMBERS_PANEL]: "members",
};

/** Opens Group settings or Members once when the route asks (`?panel=group-settings|members`). */
function useChatPanelParam(group: boolean, open: (detail: ChatOptionsDetail) => void) {
  const { panel } = useLocalSearchParams<{ panel?: string }>();
  const router = useRouter();
  const { setVisible } = useChatOptionsState();
  useEffect(() => {
    if (!group) return;
    const detail = PANEL_DETAILS[panel ?? ""];
    if (!detail) return;
    setVisible(false);
    open(detail);
    router.setParams({ panel: undefined });
  }, [panel, group, open, router, setVisible]);
}

const styles = StyleSheet.create(() => ({
  touchTarget: { width: 44, height: 44 },
}));
