import { useEffect, useRef } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { useIsFocused } from "expo-router/react-navigation";
import { Button } from "@/components/ui/button";
import { useIsCompactFormFactor } from "@/constants/layout";
import { usePanelStore } from "@/stores/panel-store";
import { useIsMobilePanelActive } from "@/mobile-panels/provider";
import { NAVIGATION_V2_ENABLED } from "@/clisbot/navigation/feature";
import { rememberListSection } from "@/clisbot/navigation/mobile-tabs";
import { HOME_TAB_PATH, rememberChatReturn, useNavigateHomeTab } from "./mobile-navigation";

/**
 * A list tab's page (Chat, or Navigation V2's Chats and Work). On a phone it is the conversation
 * list panel, with no page of its own; on desktop the list is the pane beside it and this page
 * waits for a pick.
 */
export function ListTabPage({ path }: { path: string }) {
  const focused = useIsFocused();
  const compact = useIsCompactFormFactor();
  useEffect(() => {
    if (!focused) return;
    if (NAVIGATION_V2_ENABLED) rememberListSection(path);
    if (NAVIGATION_V2_ENABLED && !compact) {
      usePanelStore.getState().openDesktopAgentList();
      return;
    }
    rememberChatReturn(path);
    usePanelStore.getState().showMobileAgentList();
  }, [compact, focused, path]);
  useLeaveWhenSidebarCloses(focused && (compact || !NAVIGATION_V2_ENABLED));
  if (NAVIGATION_V2_ENABLED && !compact) return <PickPrompt />;
  return (
    <View style={styles.fill}>
      <Button variant="ghost" onPress={openList}>
        Browse conversations
      </Button>
    </View>
  );
}

function PickPrompt() {
  const { t } = useTranslation();
  return (
    <View style={styles.fill} testID="list-tab-pick">
      <Text style={styles.hint}>{t("navigation.lists.noSelection")}</Text>
    </View>
  );
}

/**
 * The phone's list has no page of its own: if the list closes while this route is focused
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
