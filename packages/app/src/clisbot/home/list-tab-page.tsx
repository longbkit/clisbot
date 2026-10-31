import { memo, useEffect, useRef } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { useIsFocused } from "expo-router/react-navigation";
import { Button } from "@/components/ui/button";
import { useIsCompactFormFactor } from "@/constants/layout";
import { usePanelStore } from "@/stores/panel-store";
import { useIsMobilePanelActive } from "@/mobile-panels/provider";
import { NAVIGATION_V2_ENABLED } from "@/clisbot/navigation/feature";
import { PhoneListTab } from "@/clisbot/navigation/list-panel";
import { rememberListSection } from "@/clisbot/navigation/mobile-tabs";
import { WORK_PATH } from "@/clisbot/navigation/sections";
import {
  HOME_TAB_PATH,
  rememberChatReturn,
  useNavigateHomeTab,
  usesPhoneTabs,
} from "./mobile-navigation";

/**
 * A list tab's page (Chat, or Navigation V2's Chats and Work). A Navigation V2 phone shows the
 * list as the tab screen itself. On desktop the list is the pane beside this page, which waits for
 * a pick. The Home V2 phone's page is empty under the conversation list panel.
 */
export const ListTabPage = memo(function ListTabPage({ path }: { path: string }) {
  const focused = useIsFocused();
  const compact = useIsCompactFormFactor();
  const phoneTabs = usesPhoneTabs(compact);
  useEffect(() => {
    if (!focused) return;
    if (NAVIGATION_V2_ENABLED) rememberListSection(path);
    if (phoneTabs) {
      rememberChatReturn(path);
      return;
    }
    if (NAVIGATION_V2_ENABLED) {
      usePanelStore.getState().openDesktopAgentList();
      return;
    }
    rememberChatReturn(path);
    usePanelStore.getState().showMobileAgentList();
  }, [focused, path, phoneTabs]);
  useLeaveWhenSidebarCloses(focused && !NAVIGATION_V2_ENABLED);
  if (phoneTabs) return <PhoneListTab section={path === WORK_PATH ? "work" : "chats"} />;
  if (NAVIGATION_V2_ENABLED) return <PickPrompt />;
  return (
    <View style={styles.fill}>
      <Button variant="ghost" onPress={openList}>
        Browse conversations
      </Button>
    </View>
  );
});

function PickPrompt() {
  const { t } = useTranslation();
  return (
    <View style={styles.fill} testID="list-tab-pick">
      <Text style={styles.hint}>{t("navigation.lists.noSelection")}</Text>
    </View>
  );
}

/**
 * The Home V2 phone's list has no page of its own: if the list closes while this route is focused
 * (anything that still closes the panel), go Home rather than leave this empty page. It waits for
 * the settled panel, not the close request: picking a conversation also closes the panel, and by
 * the time that settles this route has lost focus.
 */
function useLeaveWhenSidebarCloses(focused: boolean) {
  const navigate = useNavigateHomeTab();
  const open = useIsMobilePanelActive("agent-list");
  const closed = useIsMobilePanelActive("agent");
  const wasOpen = useRef(false);
  useEffect(() => {
    if (!focused) {
      wasOpen.current = false;
      return;
    }
    if (open) wasOpen.current = true;
    else if (closed && wasOpen.current) {
      wasOpen.current = false;
      navigate(HOME_TAB_PATH);
    }
  }, [closed, focused, navigate, open]);
}

function openList() {
  usePanelStore.getState().showMobileAgentList();
}

const styles = StyleSheet.create((theme) => ({
  fill: { flex: 1, alignItems: "center", justifyContent: "center" },
  hint: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.base },
}));
