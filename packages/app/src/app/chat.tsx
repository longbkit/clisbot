import { useEffect } from "react";
import { View } from "react-native";
import { Button } from "@/components/ui/button";
import { useIsFocused } from "@react-navigation/native";
import { usePanelStore } from "@/stores/panel-store";
import { rememberChatReturn } from "@/clisbot/home/mobile-navigation";
/** Chat is the existing conversation sidebar, with no second list or navigation owner. */
export default function ChatTab() {
  const focused = useIsFocused();
  useEffect(() => {
    if (focused) {
      rememberChatReturn("/chat");
      usePanelStore.getState().showMobileAgentList();
    }
  }, [focused]);
  return (
    <View style={fill}>
      <Button variant="ghost" onPress={openChats}>
        Browse conversations
      </Button>
    </View>
  );
}

const fill = { flex: 1, alignItems: "center", justifyContent: "center" } as const;
function openChats() {
  usePanelStore.getState().showMobileAgentList();
}
