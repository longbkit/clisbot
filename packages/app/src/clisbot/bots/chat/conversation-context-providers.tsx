import { ConversationDraftProvider } from "./conversation-draft-provider";
import { useMemo, type ReactNode } from "react";
import {
  ConversationGroupContext,
  ConversationSourceLabelsContext,
} from "./conversation-source-labels";
import { ConversationPanelProviders } from "./conversation-panel-providers";
import { ConversationContentContext } from "./conversation-panel";
import { ConversationFileContext, type OpenConversationTarget } from "./conversation-file-context";
import { ConversationShellContext } from "./conversation-shell-context";
import { ConversationProjectContext } from "./conversation-project-context";
import { ConversationAccessContext, conversationSourceKey } from "./conversation-access";
import type { useConversationProject } from "./use-conversation-project";
import type { ChatBotIdentity } from "./chat-rows";
export function ConversationContextProviders({
  serverId,
  chatId,
  bots,
  group,
  project,
  layoutKey,
  open,
  messages,
  children,
}: {
  serverId: string;
  chatId: string;
  bots: readonly ChatBotIdentity[];
  group: boolean;
  project: ReturnType<typeof useConversationProject>;
  layoutKey: string;
  open: OpenConversationTarget;
  messages: ReactNode;
  children: ReactNode;
}) {
  const labels = useMemo(
    () =>
      new Map(
        bots
          .filter((bot) => bot.workspaceId)
          .map((bot) => [conversationSourceKey(serverId, bot.workspaceId!), bot.name]),
      ),
    [bots, serverId],
  );
  const allowed = useMemo(() => new Set(labels.keys()), [labels]);
  const setChooser = project.setChooser;
  const context = useMemo(
    () => ({
      serverId,
      botId: project.selectedBot?.botId,
      agentId: project.selectedBot?.agentId,
      canConfigure: project.selectedBot?.canConfigure,
      botName: project.selectedBot?.name,
      workspaceId: project.source?.workspaceId,
      cwd: project.cwd,
      isGit: project.isGit,
      group: bots.length > 1,
      chooseBot: () => setChooser(true),
    }),
    [
      serverId,
      project.selectedBot?.botId,
      project.selectedBot?.agentId,
      project.selectedBot?.canConfigure,
      project.selectedBot?.name,
      project.source?.workspaceId,
      project.cwd,
      project.isGit,
      setChooser,
      bots.length,
    ],
  );
  return (
    <ConversationDraftProvider serverId={serverId} chatId={chatId} layoutKey={layoutKey}>
      <ConversationSourceLabelsContext.Provider value={labels}>
        <ConversationAccessContext.Provider value={allowed}>
          <ConversationProjectContext.Provider value={context}>
            <ConversationContentProviders
              open={open}
              messages={messages}
              group={group}
              layoutKey={layoutKey}
            >
              {children}
            </ConversationContentProviders>
          </ConversationProjectContext.Provider>
        </ConversationAccessContext.Provider>
      </ConversationSourceLabelsContext.Provider>
    </ConversationDraftProvider>
  );
}

function ConversationContentProviders({
  open,
  messages,
  group,
  layoutKey,
  children,
}: {
  open: OpenConversationTarget;
  messages: ReactNode;
  group: boolean;
  layoutKey: string;
  children: ReactNode;
}) {
  return (
    <ConversationShellContext.Provider value>
      <ConversationFileContext.Provider value={open}>
        <ConversationContentContext.Provider value={messages}>
          <ConversationGroupContext.Provider value={group}>
            <ConversationPanelProviders layoutKey={layoutKey}>
              {children}
            </ConversationPanelProviders>
          </ConversationGroupContext.Provider>
        </ConversationContentContext.Provider>
      </ConversationFileContext.Provider>
    </ConversationShellContext.Provider>
  );
}
