import { useCallback, type ReactNode } from "react";
import { AssistantFileLinkResolverProvider } from "@/assistant-file-links/provider";
import { normalizeInlinePathTarget, type InlinePathTarget } from "@/assistant-file-links/parse";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useOpenConversationTarget } from "./conversation-file-context";
import {
  createWorkspaceFileTabTarget,
  normalizeWorkspaceFileLocation,
} from "@/workspace/file-open";
import type { ChatBotIdentity } from "./chat-rows";

/** Each bot owns its home: group answers must resolve relative paths against that bot. */
export function BotWorkspaceContext({
  serverId,
  bot,
  children,
}: {
  serverId: string;
  bot: ChatBotIdentity;
  children: ReactNode;
}) {
  const client = useHostRuntimeClient(serverId);
  const openInConversation = useOpenConversationTarget();
  const open = useCallback(
    (target: InlinePathTarget) => {
      if (!bot.cwd || !bot.workspaceId) return;
      const normalized = normalizeInlinePathTarget(target.path, bot.cwd);
      if (!normalized) return;
      const location = normalized.file
        ? normalizeWorkspaceFileLocation({
            path: normalized.file,
            lineStart: target.lineStart,
            lineEnd: target.lineEnd,
          })
        : null;
      openInConversation?.(
        { serverId, workspaceId: bot.workspaceId },
        location ? createWorkspaceFileTabTarget(location) : { kind: "files" },
      );
    },
    [bot.cwd, bot.workspaceId, serverId, openInConversation],
  );
  return (
    <AssistantFileLinkResolverProvider
      client={client}
      serverId={serverId}
      workspaceRoot={bot.cwd}
      onOpenWorkspaceFile={open}
    >
      {children}
    </AssistantFileLinkResolverProvider>
  );
}
