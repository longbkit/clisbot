import { memo, useState } from "react";
import { View } from "react-native";
import { usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet } from "react-native-unistyles";
import { useBotsFeatureHosts } from "@/clisbot/bots/feature";
import {
  CreationSheets,
  useDefaultCreationServerId,
  useSidebarCatalog,
} from "@/clisbot/bots/sidebar/sections";
import { useCreationActions } from "@/clisbot/bots/sidebar/use-section-actions";
import { useBotSidebarActions } from "@/clisbot/bots/sidebar/use-sidebar-actions";
import { useBotCreationHosts } from "@/clisbot/bots/feature";
import type { ChatListAdmission } from "@/clisbot/home/use-chat-list-navigation";
import { DesktopSidebarFrame } from "@/components/desktop-sidebar-frame";
import {
  RetainedPanel,
  RetainedPanelActivity,
  useRetainedPanelActive,
} from "@/components/retained-panel";
import { SidebarModelProvider } from "@/components/sidebar/sidebar-model";
import { WorkspaceShortcutTargetsSubscriber } from "@/components/workspace-shortcut-targets-subscriber";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useActiveAfterShow } from "@/hooks/use-held-while-inactive";
import { WindowChromeSafeArea } from "@/utils/desktop-window";
import { ChatsPane } from "./chats-pane";
import { NavigationRail } from "./rail";
import { CHATS_PATH, WORK_PATH, sectionHasListPane } from "./sections";
import { useNavigationStore, type ListSection } from "./store";
import { useNavigationSearchIntegration } from "./search-integration";
import { useActiveSection } from "./use-open-section";
import { WorkPane } from "./work-pane";
import { useTrackOpenedSession } from "./opened-session";

/**
 * Navigation V2's chrome in place of the sidebar (docs/features/navigation-v2/README.md): the
 * desktop rail beside the Chats/Work list pane. Phones have no list chrome: Chats and Work are
 * tab screens (`PhoneListTab`).
 */
export const NavigationChrome = memo(function NavigationChrome({
  active,
  railVisible,
}: {
  active: boolean;
  railVisible: boolean;
}) {
  const compact = useIsCompactFormFactor();
  useNavigationSearchIntegration();
  useTrackOpenedSession();
  return (
    <>
      {compact ? null : (
        <View style={styles.desktop}>
          {railVisible ? <NavigationRail /> : null}
          <DesktopListPane active={active} />
        </View>
      )}
      <ChatCreationHost />
    </>
  );
});

function useListSection(): ListSection {
  const pathname = usePathname();
  const lastList = useNavigationStore((state) => state.lastList);
  if (pathname === CHATS_PATH) return "chats";
  if (pathname === WORK_PATH) return "work";
  return lastList;
}

/**
 * Chats and Work mount on their first visit and stay mounted on every platform, so a tab switch
 * only flips visibility. Each pane holds its inputs while its retained panel is inactive
 * (`useHeldWhileInactive`), so a hidden list does not re-render on Host updates.
 */
export function ListContent({
  section,
  onBeforeNavigate,
  active,
}: {
  section: ListSection;
  onBeforeNavigate?: ChatListAdmission;
  active: boolean;
}) {
  const [chatSearchOpen, setChatSearchOpen] = useState(false);
  const [chatSearch, setChatSearch] = useState("");
  const [visited, setVisited] = useState<ReadonlySet<ListSection>>(() =>
    active ? new Set([section]) : new Set(),
  );
  if (active && !visited.has(section)) setVisited(new Set([...visited, section]));
  return (
    <>
      {visited.has("chats") ? (
        <RetainedPanel active={section === "chats"} style={styles.content}>
          <ChatsPane
            onBeforeNavigate={onBeforeNavigate}
            searchOpen={chatSearchOpen}
            setSearchOpen={setChatSearchOpen}
            search={chatSearch}
            setSearch={setChatSearch}
          />
        </RetainedPanel>
      ) : null}
      {visited.has("work") ? (
        <RetainedPanel active={section === "work"} style={styles.content}>
          <WorkPane onBeforeNavigate={onBeforeNavigate} active={active && section === "work"} />
        </RetainedPanel>
      ) : null}
    </>
  );
}

/**
 * A phone's Chats or Work tab: the list is the tab screen, with no panel to slide. The tab
 * navigator keeps it mounted and marks it inactive while hidden; each pane holds its inputs then.
 * Work owns the phone's only sidebar model (the sidebar chrome mounts none on phone tabs), so it
 * also feeds the workspace shortcut targets; hidden, the model derives nothing and the targets
 * stay as Work last showed them.
 */
export const PhoneListTab = memo(function PhoneListTab({ section }: { section: ListSection }) {
  return (
    <View style={styles.phoneList}>
      <WindowChromeSafeArea placement="below" />
      {section === "chats" ? <PhoneChats /> : <PhoneWork />}
    </View>
  );
});

function PhoneChats() {
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  return (
    <ChatsPane
      searchOpen={searchOpen}
      setSearchOpen={setSearchOpen}
      search={search}
      setSearch={setSearch}
    />
  );
}

/**
 * The tab shows in the press's commit with the held model. The model's catch-up and the list's
 * drag-host flag follow in a low-priority render (`useActiveAfterShow`): the flag reaches every
 * project block, so flipping it in the press re-rendered the whole list there.
 */
function PhoneWork() {
  const active = useRetainedPanelActive();
  const caughtUp = useActiveAfterShow(active);
  return (
    <SidebarModelProvider active={active} holdWhileInactive>
      <WorkPane active={caughtUp} />
      <WorkspaceShortcutTargetsSubscriber enabled />
    </SidebarModelProvider>
  );
}

function DesktopListPane({ active }: { active: boolean }) {
  const insets = useSafeAreaInsets();
  const section = useListSection();
  const activeSection = useActiveSection();
  const shown = active && sectionHasListPane(activeSection);
  return (
    <RetainedPanelActivity active={shown}>
      <DesktopSidebarFrame active={shown} insetsTop={insets.top}>
        <ListContent section={section} active={shown} />
      </DesktopSidebarFrame>
    </RetainedPanelActivity>
  );
}

/**
 * New bot and New group sheets, asked for from Chats ✎, Home or the Command Center. Always mounted
 * while the chrome is, as the sidebar's Bots section was, so a request never waits for a list.
 */
function ChatCreationHost() {
  const hosts = useBotsFeatureHosts();
  return hosts.length ? <EnabledCreationHost /> : null;
}

function EnabledCreationHost() {
  const { hosts, botRows, chatRows, chats } = useSidebarCatalog();
  const creationHosts = useBotCreationHosts();
  const defaultServerId = useDefaultCreationServerId(creationHosts, chatRows);
  const { openBot, navigate } = useBotSidebarActions(
    chatRows,
    undefined,
    chats.loadState.status === "loaded",
  );
  const {
    openCreate: _openCreate,
    openGroup: _openGroup,
    onPressBot: _onPressBot,
    ...creation
  } = useCreationActions(openBot, navigate);
  return (
    <CreationSheets
      {...creation}
      defaultServerId={defaultServerId}
      hosts={hosts}
      creationHosts={creationHosts}
      botRows={botRows}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  desktop: { flexDirection: "row", height: "100%" },
  phoneList: { flex: 1, minHeight: 0, backgroundColor: theme.colors.surfaceSidebar },
  content: { flex: 1, minHeight: 0 },
}));
