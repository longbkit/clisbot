import { useChatOptionsState } from "./chat-options-context";
import { Ellipsis } from "lucide-react-native";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useCallback, useEffect, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { ChatPayload } from "@clisbot/protocol/chats/types";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { BotPayload } from "../data/contracts";
import type { ChatResourceAction, ChatResourceActionId } from "./chat-resource-actions";
import { GROUP_SETTINGS_PANEL } from "./chat-panel-param";
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
import { iconButtonChromeStyle, mutedIconColorMapping } from "@/components/ui/icon-button-chrome";
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
  const openGroupSettings = useCallback(() => setDetail("participants"), []);
  const openProject = useCallback(() => setDetail("project"), []);
  useGroupSettingsPanel(group, openGroupSettings);
  const { actions, runAction } = useChatResourceMenu({
    serverId,
    chat,
    bots,
    group,
    close,
    openGroupSettings,
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

/** The trigger and the menu: tabs, the chat's own actions, Project actions, fresh session. */
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
  return (
    <DropdownMenu compactMode="sheet" open={visible} onOpenChange={setVisible}>
      <DropdownMenuTrigger
        accessibilityLabel="Chat options"
        testID="chat-options-trigger"
        style={triggerStyle}
      >
        <ThemedEllipsis size={18} uniProps={mutedIconColorMapping} />
      </DropdownMenuTrigger>
      <DropdownMenuContent sheetTitle="Chat options" align="end" width={280} pages={pages}>
        <DropdownMenuSubTrigger id="tabs" disabled={!tabCount} value={String(tabCount)}>
          Switch tab
        </DropdownMenuSubTrigger>
        <DropdownMenuSeparator />
        {actions
          .filter((action) => action.id !== "archive")
          .map((action) => (
            <ResourceActionItem key={action.id} action={action} onSelect={onAction} />
          ))}
        {project ? (
          <DropdownMenuItem onSelect={onOpenProject}>Project actions</DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuSubTrigger id="fresh">Start a fresh session</DropdownMenuSubTrigger>
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

const styles = StyleSheet.create(() => ({
  touchTarget: { width: 44, height: 44 },
}));
