import { useCallback } from "react";
import { Text } from "react-native";
import { useTranslation } from "react-i18next";
import { ChevronDown } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import { useBotsFeatureHosts } from "@/clisbot/bots/feature";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { MenuTriggerState } from "@/components/ui/menu/menu-root";
import {
  isToolbarLabelTriggerHighlighted,
  toolbarLabelTriggerStyle,
  toolbarLabelTriggerTextStyle,
  ToolbarLabelTriggerIcon,
} from "@/components/ui/toolbar-label-trigger";
import { useNavigationStore } from "./store";

const Chevron = withUnistyles(ChevronDown, (theme) => ({ color: theme.colors.foregroundMuted }));

/**
 * Chats' one Display menu for the mixed list (brief C7a): order, the opt-in Bot chats / groups
 * split (off by default, brief C3), and which Hosts it lists when there are several.
 */
export function ChatsDisplayMenu() {
  const { t } = useTranslation();
  const sort = useNavigationStore((state) => state.chatsSort);
  const setSort = useNavigationStore((state) => state.setChatsSort);
  const split = useNavigationStore((state) => state.chatsSplit);
  const toggleSplit = useNavigationStore((state) => state.toggleChatsSplit);
  const selectedHosts = useNavigationStore((state) => state.chatsHosts);
  const clearHosts = useNavigationStore((state) => state.clearChatsHosts);
  const hosts = useBotsFeatureHosts();
  const filtered = selectedHosts.length > 0;
  const label = filtered ? `${t("navigation.display")} ·` : t("navigation.display");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        style={toolbarLabelTriggerStyle}
        accessibilityLabel={t("navigation.display")}
        testID="chats-display"
      >
        {(state: MenuTriggerState) => (
          <>
            <Text style={toolbarLabelTriggerTextStyle(isToolbarLabelTriggerHighlighted(state))}>
              {label}
            </Text>
            <ToolbarLabelTriggerIcon>
              <Chevron size={12} />
            </ToolbarLabelTriggerIcon>
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" width={280} sheetTitle={t("navigation.display")}>
        <DropdownMenuLabel>{t("navigation.chatsDisplay.sort")}</DropdownMenuLabel>
        <SortItem value="recent" current={sort} onSelect={setSort} />
        <SortItem value="name" current={sort} onSelect={setSort} />
        <DropdownMenuSeparator />
        <DropdownMenuItem
          selected={split}
          showSelectedCheck
          closeOnSelect={false}
          onSelect={toggleSplit}
          testID="chats-display-split"
        >
          {t("navigation.chatsDisplay.split")}
        </DropdownMenuItem>
        {hosts.length > 1 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{t("navigation.chatsDisplay.hosts")}</DropdownMenuLabel>
            <DropdownMenuItem
              selected={!filtered}
              showSelectedCheck
              closeOnSelect={false}
              onSelect={clearHosts}
              testID="chats-display-all-hosts"
            >
              {t("navigation.chatsDisplay.allHosts")}
            </DropdownMenuItem>
            {hosts.map((host) => (
              <HostItem key={host.serverId} serverId={host.serverId} label={host.label} />
            ))}
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SortItem({
  value,
  current,
  onSelect,
}: {
  value: "recent" | "name";
  current: "recent" | "name";
  onSelect: (value: "recent" | "name") => void;
}) {
  const { t } = useTranslation();
  const select = useCallback(() => onSelect(value), [onSelect, value]);
  return (
    <DropdownMenuItem
      selected={current === value}
      showSelectedCheck
      onSelect={select}
      testID={`chats-display-sort-${value}`}
    >
      {t(`navigation.chatsDisplay.${value}`)}
    </DropdownMenuItem>
  );
}

function HostItem({ serverId, label }: { serverId: string; label: string }) {
  const selected = useNavigationStore((state) => state.chatsHosts.includes(serverId));
  const toggle = useNavigationStore((state) => state.toggleChatsHost);
  const select = useCallback(() => toggle(serverId), [serverId, toggle]);
  return (
    <DropdownMenuItem
      selected={selected}
      showSelectedCheck
      closeOnSelect={false}
      onSelect={select}
      testID={`chats-display-host-${serverId}`}
    >
      {label}
    </DropdownMenuItem>
  );
}
