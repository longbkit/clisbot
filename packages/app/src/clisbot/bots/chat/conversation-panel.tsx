import { usePaneFocus } from "@/panels/pane-context";
import { RetainedPanelActivity } from "@/components/retained-panel";
import { createContext, useContext, type ReactNode } from "react";
import { MessageSquare } from "lucide-react-native";
import { definePanel } from "@/panels/panel-registry";

export const ConversationContentContext = createContext<ReactNode>(null);
function ConversationPanel() {
  const content = useContext(ConversationContentContext);
  const focus = usePaneFocus();
  return <RetainedPanelActivity active={focus.isInteractive}>{content}</RetainedPanelActivity>;
}
export const conversationPanelRegistration = definePanel("conversation", {
  component: ConversationPanel,
  presentation: {
    label: () => "Messages",
    subtitle: () => "",
    tooltip: () => "Messages",
    icon: MessageSquare,
  },
});
