// A Chat Bot moved to another provider (`chat.session.fork`, docs/features/bots-and-chats/README.md
// "Switching provider"). The previous session's conversation is read through the Host's own
// timeline when the switch is confirmed, before anything changes, and kept by the daemon in the
// chat's `fork-carry.json` (`fork-carry-store.ts`), never on a label. The new session's next
// message carries it as the same `chat_history` attachment an agent fork uses; it is removed only
// once that message was handed over, so a failed delivery or a restart retries with it. A second
// switch before that keeps the first carry.
import type { BotLaunchDefaults } from "@clisbot/protocol/bots/types";
import type { Logger } from "pino";
import { buildAgentForkContextAttachment } from "../agent/activity-curator.js";
import { ensureAgentLoaded } from "../agent/agent-loading.js";
import type { AgentManager } from "../agent/agent-manager.js";
import type { AgentStorage } from "../agent/agent-storage.js";
import { formatProviderModel } from "../agent/create-agent/create.js";
import type { ForkCarryInput } from "./bot-sessions.js";
import type { ForkCarry } from "./fork-carry-store.js";
import { chatKindOf, type ChatBot, type StoredChat } from "./chat-record.js";

const STALE_CONFIRMATION =
  "This chat changed since you chose the provider. Look at it again and choose once more.";

export interface SessionForks {
  /** The session's conversation as a `chat_history` attachment; throws when it cannot be read. */
  contextOf(agentId: string): Promise<ForkCarryInput["attachment"]>;
}

export function createSessionForks(deps: {
  agentManager: AgentManager;
  agentStorage: AgentStorage;
  logger: Logger;
}): SessionForks {
  const { agentManager, agentStorage, logger } = deps;
  return {
    async contextOf(agentId) {
      const snapshot = await ensureAgentLoaded(agentId, { agentManager, agentStorage, logger });
      const timeline = await agentManager.fetchTimelineForRead(agentId, {
        direction: "tail",
        limit: 0,
      });
      const record = await agentStorage.get(agentId);
      return buildAgentForkContextAttachment({
        rows: timeline.rows,
        agentTitle: record?.title ?? null,
        cwd: snapshot.cwd,
      }).attachment;
    },
  };
}

/** Throws the person-facing reason a fork cannot run; nothing has changed yet. */
export function assertForkable(chat: StoredChat, bot: ChatBot, launch: BotLaunchDefaults): void {
  if (chatKindOf(chat) !== "direct")
    throw new Error("Switching provider is only available in a direct chat.");
  const current = chat.launch ?? bot.launch;
  if (current.provider === launch.provider)
    throw new Error("This is the same provider; change the model in place instead.");
}

/**
 * A confirmation that arrives after the fork it asked for already happened (a retry, a double
 * press): the session it made, when the chat still holds exactly that fork. Any other change
 * since the person looked is refused, so a stale confirmation never forks the wrong session.
 */
export function repeatedFork(
  chat: StoredChat,
  carry: ForkCarry | null,
  botId: string,
  launch: BotLaunchDefaults,
  expectedAgentId: string | null,
): string | null {
  const participant = chat.participants.find((entry) => entry.botId === botId);
  if (!participant || participant.agentId === expectedAgentId) return null;
  const sameLaunch =
    chat.launch?.provider === launch.provider &&
    (chat.launch?.model ?? null) === (launch.model ?? null);
  const fromExpected = expectedAgentId === null || carry?.previousAgentId === expectedAgentId;
  if (sameLaunch && fromExpected && participant.agentId) return participant.agentId;
  throw new Error(STALE_CONFIRMATION);
}

export function forkNotice(bot: ChatBot, launch: BotLaunchDefaults, carries: boolean): string {
  const target = formatProviderModel(launch.provider, launch.model);
  return carries
    ? `${bot.displayName} moved to ${target} in a new session. The earlier conversation goes with the next message; the previous session stays in Cowork.`
    : `${bot.displayName} moved to ${target} in a new session.`;
}
