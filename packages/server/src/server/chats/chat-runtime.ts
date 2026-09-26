import type { BotService } from "../bots/index.js";
import { createChatService, type ChatServiceOptions, type ChatService } from "./chat-service.js";

/** Disabled runtime has no storage or subscriptions; keeps bootstrap free of Chat policy. */
export async function startChatRuntime(
  bots: BotService | null,
  options: Omit<ChatServiceOptions, "bots" | "publisher">,
  publishProjects: () => Promise<void>,
): Promise<{ service: ChatService | undefined; stop(): Promise<void> }> {
  if (!bots) return { service: undefined, stop: async () => {} };
  const unsubscribe = bots.subscribe(() => {
    void publishProjects().catch((err: unknown) =>
      options.logger.warn({ err }, "Bot Project publication failed"),
    );
  });
  const service = createChatService({
    ...options,
    bots: {
      get: async (id) => {
        const bot = await bots.get(id);
        return bot && !bot.archivedAt ? { ...bot, displayName: bot.name } : null;
      },
    },
    publisher: { chatUpdated: () => {}, transcriptAppended: () => {} },
  });
  await service.start();
  return {
    service,
    async stop() {
      unsubscribe();
      await service.stop();
    },
  };
}
