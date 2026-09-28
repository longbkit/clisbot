import { useMemo, type ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useIsFocused } from "@react-navigation/native";
import { RetainedPanelActivity } from "@/components/retained-panel";
import { useIsCompactFormFactor, supportsDesktopPaneSplits } from "@/constants/layout";
import { useConversationLayout } from "./use-conversation-layout";
import { useConversationProject } from "./use-conversation-project";
import { useConversationTabs } from "./use-conversation-tabs";
import { useConversationExplorer } from "./use-conversation-explorer";
import { DesktopConversationSurface, MobileConversationSurface } from "./conversation-surfaces";
import {
  ConversationHeader,
  ConversationBotSelector,
  ConversationBotChooser,
} from "./conversation-header";
import { ConversationContextProviders } from "./conversation-context-providers";
import { ConversationTabsContext } from "./conversation-tabs-context";
import { ChatOptionsProvider } from "./chat-options-context";
import type { ChatBotIdentity } from "./chat-rows";
interface ConversationWorkspaceProps {
  serverId: string;
  chatId: string;
  accessScope: string;
  title: string;
  bots: readonly ChatBotIdentity[];
  group: boolean;
  headerActions?: ReactNode;
  children: ReactNode;
}
/** Conversation layout, RPC source context, and existing panel UI have separate owners. */
export function ConversationWorkspace({
  serverId,
  chatId,
  accessScope,
  title,
  bots,
  group,
  headerActions,
  children,
}: ConversationWorkspaceProps) {
  const focused = useIsFocused();
  const compact = useIsCompactFormFactor();
  const singlePanel = compact || !supportsDesktopPaneSplits();
  const state = useConversationLayout(serverId, chatId, accessScope);
  const project = useConversationProject(serverId, bots, focused);
  const actions = useConversationTabs({
    serverId,
    bots,
    layoutKey: state.layoutKey,
    singlePanel,
    tabs: state.tabs,
    selectBot: project.setSelectedBotId,
  });
  const openExplorer = useConversationExplorer({
    layoutKey: state.layoutKey,
    focused,
    singlePanel,
    ...project,
  });
  const selector = useMemo(
    () => (bots.length > 1 ? <ConversationBotSelector project={project} /> : null),
    [bots.length, project],
  );
  const header = () => (
    <ConversationHeader
      {...{ serverId, title, project, singlePanel, selector, headerActions, openExplorer, group }}
      memberCount={bots.length}
      tabCount={state.mainTabs.length}
    />
  );
  const surface = { serverId, focused, state, actions, header };
  const tabContext = useMemo(
    () => ({ tabs: state.mainTabs, activeId: state.active?.tabId, selectTab: actions.selectTab }),
    [state.mainTabs, state.active?.tabId, actions.selectTab],
  );
  return (
    <RetainedPanelActivity active={focused}>
      <ChatOptionsProvider>
        <ConversationTabsContext.Provider value={tabContext}>
          <ConversationContextProviders
            serverId={serverId}
            chatId={chatId}
            bots={bots}
            group={group}
            project={project}
            layoutKey={state.layoutKey}
            open={actions.open}
            messages={children}
          >
            <View style={styles.fill}>
              {singlePanel ? (
                <MobileConversationSurface
                  {...surface}
                  project={project}
                  selector={selector}
                  compact={compact}
                />
              ) : (
                <DesktopConversationSurface {...surface} openExplorer={openExplorer} />
              )}
              <ConversationBotChooser project={project} bots={bots} />
            </View>
          </ConversationContextProviders>
        </ConversationTabsContext.Provider>
      </ChatOptionsProvider>
    </RetainedPanelActivity>
  );
}
const styles = StyleSheet.create((theme) => ({
  fill: { flex: 1, minHeight: 0, minWidth: 0, backgroundColor: theme.colors.surface0 },
}));
