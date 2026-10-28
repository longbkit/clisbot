import { memo, useMemo, useState } from "react";
import { Platform, View } from "react-native";
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
import { MobileChatPanelTabs } from "@/clisbot/home/mobile-navigation";
import { PendingChatPresentation } from "@/clisbot/home/pending-chat-presentation";
import {
  useChatListNavigation,
  type ChatListAdmission,
} from "@/clisbot/home/use-chat-list-navigation";
import { DesktopSidebarFrame } from "@/components/desktop-sidebar-frame";
import { RetainedPanel, RetainedPanelActivity } from "@/components/retained-panel";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useCloseAgentListGesture } from "@/mobile-panels/gestures";
import { MobilePanelOverlay } from "@/mobile-panels/presentation";
import { usePanelStore } from "@/stores/panel-store";
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
 * desktop rail beside the Chats/Work list pane, or the phone's retained list panel. Both keep the
 * sidebar's panel ownership, so presentation, Back and retained state stay one implementation.
 */
export const NavigationChrome = memo(function NavigationChrome({
  active,
  presented,
  railVisible,
}: {
  active: boolean;
  presented: boolean;
  railVisible: boolean;
}) {
  const compact = useIsCompactFormFactor();
  useNavigationSearchIntegration();
  useTrackOpenedSession();
  return (
    <>
      {compact ? (
        <MobileListPanel active={active} presented={presented} />
      ) : (
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
 * Desktop keeps both lists mounted. On Android phones, a hidden Work list releases its rows
 * and subscriptions, so Host updates cannot render thousands of off-screen session lines.
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
  const compact = useIsCompactFormFactor();
  const releaseHiddenWork = compact && Platform.OS === "android";
  const [visited, setVisited] = useState<ReadonlySet<ListSection>>(() => new Set([section]));
  if (!visited.has(section)) setVisited(new Set([...visited, section]));
  return (
    <>
      {visited.has("chats") ? (
        <RetainedPanel active={section === "chats"} style={styles.content}>
          <ChatsPane onBeforeNavigate={onBeforeNavigate} />
        </RetainedPanel>
      ) : null}
      {visited.has("work") ? (
        <RetainedPanel active={section === "work"} style={styles.content}>
          {!releaseHiddenWork || (active && section === "work") ? (
            <WorkPane onBeforeNavigate={onBeforeNavigate} active={active && section === "work"} />
          ) : null}
        </RetainedPanel>
      ) : null}
    </>
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

function MobileListPanel({ active, presented }: { active: boolean; presented: boolean }) {
  const closeList = usePanelStore((state) => state.showMobileAgent);
  const admission = useChatListNavigation(closeList);
  const section = useListSection();
  // The list is a tab page: no close gesture, and the tab bar under it owns the bottom inset.
  const { gesture } = useCloseAgentListGesture(false);
  const panelStyle = useMemo(() => [styles.panel], []);
  return (
    <RetainedPanelActivity active={active}>
      <MobilePanelOverlay
        panel="agent-list"
        presented={presented}
        closeGesture={gesture}
        panelStyle={panelStyle}
      >
        <PendingChatPresentation>
          <View style={styles.content} pointerEvents="auto">
            <WindowChromeSafeArea placement="below" />
            <ListContent section={section} onBeforeNavigate={admission} active={active} />
            <MobileChatPanelTabs />
          </View>
        </PendingChatPresentation>
      </MobilePanelOverlay>
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
  panel: { backgroundColor: theme.colors.surfaceSidebar },
  content: { flex: 1, minHeight: 0 },
}));
