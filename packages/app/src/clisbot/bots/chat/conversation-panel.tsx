import { usePaneFocus } from "@/panels/pane-context";
import { RetainedPanelActivity } from "@/components/retained-panel";
import { createContext, useContext, type ReactNode } from "react";
import { MessageSquare } from "lucide-react-native";
import { definePanel } from "@/panels/panel-registry";
import { i18n } from "@/i18n/i18next";

export const ConversationContentContext = createContext<ReactNode>(null);
function ConversationPanel() {
  const content = useContext(ConversationContentContext);
  const focus = usePaneFocus();
  return <RetainedPanelActivity active={focus.isInteractive}>{content}</RetainedPanelActivity>;
}
export const conversationPanelRegistration = definePanel("conversation", {
  component: ConversationPanel,
  presentation: {
    label: () => i18n.t("bots.chat.common.messages"),
    subtitle: () => "",
    tooltip: () => i18n.t("bots.chat.common.messages"),
    icon: MessageSquare,
  },
});
