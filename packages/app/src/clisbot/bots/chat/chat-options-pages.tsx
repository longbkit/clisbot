import { FileDiff, FileText, MessageSquare } from "lucide-react-native";
import { useCallback, useContext, useMemo, useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { DropdownMenuHint, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { MenuTextField } from "@/components/ui/menu";
import { mutedIconColorMapping } from "@/components/ui/icon-button-chrome";
import { useConversationTabsContext } from "./conversation-tabs-context";
import { ConversationSourceLabelsContext } from "./conversation-source-labels";
import { useConversationDraftContext } from "./conversation-draft-context";
import { buildConversationTabOptions, filterConversationTabs } from "./conversation-tab-options";

const ThemedMessageSquare = withUnistyles(MessageSquare);
const ThemedFileText = withUnistyles(FileText);
const ThemedFileDiff = withUnistyles(FileDiff);
const TAB_MESSAGE_ICON = <ThemedMessageSquare size={16} uniProps={mutedIconColorMapping} />;
const TAB_FILE_ICON = <ThemedFileText size={16} uniProps={mutedIconColorMapping} />;
const TAB_DIFF_ICON = <ThemedFileDiff size={16} uniProps={mutedIconColorMapping} />;

type TabOption = ReturnType<typeof buildConversationTabOptions>[number];

/** The chat options menu's sub-pages: Switch tab and Start a fresh session. */
export function useChatOptionsPages(group: boolean) {
  const { t } = useTranslation();
  const tabs = useConversationTabsContext();
  const labels = useContext(ConversationSourceLabelsContext);
  const draft = useConversationDraftContext();
  const tabOptions = useMemo(
    () => buildConversationTabOptions(tabs?.tabs ?? [], labels, group),
    [tabs?.tabs, labels, group],
  );
  const pages = useMemo(
    () => [
      {
        id: "tabs",
        title: t("bots.chat.options.switchTab"),
        hoverIntent: false,
        content: (
          <ChatTabsPage options={tabOptions} activeId={tabs?.activeId} onSelect={tabs?.selectTab} />
        ),
      },
      {
        id: "fresh",
        title: t("bots.chat.options.freshSession"),
        hoverIntent: false,
        content: (
          <>
            <DropdownMenuHint>{t("bots.chat.options.freshHint")}</DropdownMenuHint>
            <DropdownMenuItem disabled={!draft} onSelect={draft?.focusMessages}>
              {t("bots.chat.options.goToMessages")}
            </DropdownMenuItem>
          </>
        ),
      },
    ],
    [tabOptions, tabs, draft, t],
  );
  return { pages, tabCount: tabOptions.length };
}

function ChatTabsPage({
  options,
  activeId,
  onSelect,
}: {
  options: TabOption[];
  activeId?: string;
  onSelect?: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const matches = filterConversationTabs(options, query);
  return (
    <>
      <View style={styles.tabSearch}>
        <MenuTextField placeholder={t("bots.chat.options.searchTabs")} onChangeText={setQuery} />
      </View>
      {matches.map((tab) => (
        <ChatTabItem key={tab.id} tab={tab} selected={tab.id === activeId} onSelect={onSelect} />
      ))}
      {!matches.length ? (
        <DropdownMenuHint>{t("bots.chat.options.noMatchingTabs")}</DropdownMenuHint>
      ) : null}
    </>
  );
}

function ChatTabItem({
  tab,
  selected,
  onSelect,
}: {
  tab: TabOption;
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
  tabSearch: {
    paddingHorizontal: theme.spacing[2],
    paddingTop: theme.spacing[1],
    paddingBottom: theme.spacing[2],
  },
}));
