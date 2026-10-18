import { currentSessionOperationIdentity } from "../agent/session-operation-context.js";
import type { Logger } from "pino";
import type { AgentManager } from "../agent/agent-manager.js";
import { InputQueueRuntime } from "../input-queue/runtime.js";
import { attachQueueFiles, hydrateQueueContent } from "../input-queue/files.js";
import type { ChatStore } from "./chat-store.js";
import type { ChatEngine } from "./chat-engine.js";
import type { TranscriptLog } from "./transcript-log.js";

interface ChatInputQueueOptions {
  store: ChatStore;
  engine: ChatEngine;
  agentManager: AgentManager;
  transcriptOf(chatId: string): TranscriptLog;
  queues: InputQueueRuntime;
}

export function registerChatInputQueue(options: ChatInputQueueOptions, chatId: string): void {
  const { store, engine, queues, agentManager, transcriptOf } = options;
  const directory = store.directory(chatId);
  queues.register(chatId, {
    directory,
    ready: async () => {
      const chat = await store.require(chatId);
      return (
        !chat.archivedAt &&
        !engine.busy(chatId) &&
        chat.participants.every(
          (p) => !p.agentId || !agentManager.getAgent(p.agentId)?.pendingPermissions.size,
        )
      );
    },
    delivered: async (id, content) => {
      if (!(await transcriptOf(chatId).findById(id))) return false;
      if (content)
        await engine.send({
          chatId,
          messageId: id,
          ...content,
          actor: currentSessionOperationIdentity()?.actor,
        });
      return true;
    },
    handoff: async (id, content, interrupt, steerTarget) => {
      const files = await hydrateQueueContent(directory, content);
      await engine.send({
        chatId,
        messageId: id,
        ...files,
        actor: content.identity.actor,
        onlyWhenIdle: !interrupt && !steerTarget,
        ...(steerTarget ? { activeTurnBehavior: "steer" as const, steerTarget } : {}),
        ...(interrupt ? { activeTurnBehavior: "interrupt" as const } : {}),
        prepareFiles: (messageDirectory, messageId) =>
          attachQueueFiles(messageDirectory, messageId, content),
      });
    },
  });
}

export function publishChatQueueBoundary(input: {
  chatId: string;
  enabled: boolean;
  queues: InputQueueRuntime;
  store: ChatStore;
  engine: ChatEngine;
  publish: (chat: Awaited<ReturnType<ChatEngine["payload"]>>) => void;
  logger: Logger;
}): void {
  if (!input.enabled) return;
  input.queues.wake(input.chatId);
  void input.store
    .require(input.chatId)
    .then(async (chat) => input.publish(await input.engine.payload(chat)))
    .catch((err) =>
      input.logger.warn({ err, chatId: input.chatId }, "Chat boundary publication failed"),
    );
}
