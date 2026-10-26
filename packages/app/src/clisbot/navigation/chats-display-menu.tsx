import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useBotsFeatureHosts } from "@/clisbot/bots/feature";
import { DisplayMenuTrigger } from "@/components/ui/display-menu-trigger";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { DISPLAY_MENU_WIDTH } from "@/components/sidebar/display-preferences/menu";
import { HostsDisplayItems } from "./hosts-display-items";
import { useNavigationStore } from "./store";
import { useHostFilter } from "./host-filter";

/**
 * Chats' one Display menu for the mixed list (brief C7a): order, the opt-in Bot chats / groups
 * split (off by default, brief C3), and the app-wide Host filter when there are several Hosts.
 */
export function ChatsDisplayMenu() {
  const { t } = useTranslation();
  const sort = useNavigationStore((state) => state.chatsSort);
  const setSort = useNavigationStore((state) => state.setChatsSort);
  const split = useNavigationStore((state) => state.chatsSplit);
  const toggleSplit = useNavigationStore((state) => state.toggleChatsSplit);
  // The app-wide Host filter: choosing Hosts here filters Home and Workspace too.
  const {
    serverIds: selectedHosts,
    clear: clearHosts,
    toggle: toggleHost,
    active,
  } = useHostFilter();
  const hosts = useBotsFeatureHosts();
  const filtered = active;
  return (
    <DropdownMenu>
      <DisplayMenuTrigger
        label={t("navigation.display")}
        active={filtered}
        testID="chats-display"
      />
      <DropdownMenuContent
        align="start"
        width={DISPLAY_MENU_WIDTH}
        sheetTitle={t("navigation.display")}
      >
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
        <HostsDisplayItems
          hosts={hosts}
          selected={selectedHosts}
          onToggle={toggleHost}
          onClear={clearHosts}
          separated
          testID="chats-display"
        />
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
