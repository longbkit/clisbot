import { useEffect, useRef } from "react";
import { View } from "react-native";
import { Button } from "@/components/ui/button";
import { useIsFocused } from "@react-navigation/native";
import { usePanelStore } from "@/stores/panel-store";
import { useIsMobilePanelActive } from "@/mobile-panels/provider";
import {
  HOME_TAB_PATH,
  rememberChatReturn,
  useNavigateHomeTab,
} from "@/clisbot/home/mobile-navigation";
/** Chat is the existing conversation sidebar, with no second list or navigation owner. */
export default function ChatTab() {
  const focused = useIsFocused();
  useEffect(() => {
    if (focused) {
      rememberChatReturn("/chat");
      usePanelStore.getState().showMobileAgentList();
    }
  }, [focused]);
  useLeaveWhenSidebarCloses(focused);
  return (
    <View style={fill}>
      <Button variant="ghost" onPress={openChats}>
        Browse conversations
      </Button>
    </View>
  );
}

/**
 * Chat has no page of its own: if the list closes while this route is focused (anything that
 * still closes the panel), go Home rather than leave this empty page. It waits for the settled
 * panel, not the close request: picking a conversation also closes the panel, and by the time that
 * settles this route has lost focus.
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

const fill = { flex: 1, alignItems: "center", justifyContent: "center" } as const;
function openChats() {
  usePanelStore.getState().showMobileAgentList();
}
