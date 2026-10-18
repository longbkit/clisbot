import { access } from "node:fs/promises";
import path from "node:path";
import type { AgentManager } from "../agent/agent-manager.js";
import type { AgentStorage } from "../agent/agent-storage.js";
import type { Logger } from "pino";
import { ensureAgentLoaded } from "../agent/agent-loading.js";
import { sendPromptToAgent, waitForAgentRunStartWithTimeout } from "../agent/agent-prompt.js";
import { buildAgentPrompt } from "../agent/prompt-attachments.js";
import { attachSessionFiles } from "../file-upload/session-files.js";
import { attachQueueFiles } from "./files.js";
import type { StoredQueueContent } from "./content.js";
import { InputQueueRuntime, type QueueTarget } from "./runtime.js";

interface AgentInputQueueOptions {
  manager: AgentManager;
  storage: AgentStorage;
  logger: Logger;
  enabled?: boolean;
}
interface AgentQueueTarget {
  agentId: string;
  directory: string;
}

/** Host lifetime, independent of any connected app or Session. */
export class AgentInputQueues {
  readonly runtime: InputQueueRuntime;
  readonly enabled: boolean;
  private readonly unsubscribe: () => void;
  readonly ready: Promise<void>;
  constructor(private readonly options: AgentInputQueueOptions) {
    this.enabled = options.enabled !== false && options.manager.sessionStorageEnabled;
    this.runtime = new InputQueueRuntime(options.logger);
    this.unsubscribe = this.enabled
      ? options.manager.subscribe(
          (event) => {
            if (event.type === "agent_state" || event.type === "agent_stream")
              queueMicrotask(() => this.runtime.wake());
          },
          { replayState: false },
        )
      : () => {};
    this.ready = this.enabled ? this.restore() : Promise.resolve();
    void this.ready.catch((err) =>
      options.logger.error({ err }, "Agent queue initialization failed"),
    );
  }
  private async restore(): Promise<void> {
    for (const record of await this.options.storage.list()) {
      try {
        await access(
          path.join(await this.options.storage.getSessionDirectory(record.id), "queue.json"),
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      await this.register(record.id);
    }
  }
  async register(agentId: string): Promise<void> {
    if (!this.enabled)
      throw new Error("Durable Host queue is disabled or session storage is unavailable");
    const owner = { agentId, directory: await this.options.storage.getSessionDirectory(agentId) };
    this.runtime.register(agentId, this.target(owner));
  }
  private target(owner: AgentQueueTarget): QueueTarget {
    return {
      directory: owner.directory,
      ready: () => this.isReady(owner.agentId),
      delivered: async (id, content) => {
        if (!(await this.options.manager.hasDurableSubmittedMessage(owner.agentId, id)))
          return false;
        if (content) {
          const files = await attachSessionFiles({
            directory: owner.directory,
            messageId: id,
            ...content,
            ownsUpload: () => false,
          });
          await this.options.manager.verifySubmittedMessageContent(
            owner.agentId,
            id,
            buildAgentPrompt(content.text, files.images, files.attachments),
          );
        }
        return true;
      },
      handoff: (id, content, interrupt, steerTarget) =>
        this.handoff(owner, id, content, interrupt, steerTarget),
    };
  }
  private async isReady(agentId: string): Promise<boolean> {
    const { manager, storage, logger } = this.options;
    const record = await storage.get(agentId);
    if (!record || record.archivedAt) return false;
    await ensureAgentLoaded(agentId, { agentManager: manager, agentStorage: storage, logger });
    const agent = manager.getAgent(agentId);
    return Boolean(
      agent &&
      agent.lifecycle === "idle" &&
      !manager.hasInFlightRun(agentId) &&
      agent.pendingPermissions.size === 0,
    );
  }
  private async handoff(
    owner: AgentQueueTarget,
    id: string,
    content: StoredQueueContent,
    interrupt = false,
    steerTarget?: { agentId: string; turnId: string },
  ): Promise<void> {
    const { manager, storage, logger } = this.options;
    if (steerTarget && steerTarget.agentId !== owner.agentId)
      throw new Error("Steer target does not match this session");
    const files = await attachQueueFiles(owner.directory, id, content);
    if (!interrupt && !steerTarget && manager.hasInFlightRun(owner.agentId))
      throw new Error("A turn started before queue handoff; check outcome");
    const result = await sendPromptToAgent({
      agentManager: manager,
      agentStorage: storage,
      agentId: owner.agentId,
      prompt: buildAgentPrompt(content.text, files.images, files.attachments),
      messageId: id,
      replaceRunning: interrupt,
      clearPendingPermissions: interrupt,
      ...(steerTarget
        ? {
            activeTurnBehavior: "steer" as const,
            expectedTurnId: steerTarget.turnId,
            strictSteer: true,
          }
        : {}),
      logger,
    });
    if (result.disposition === "turn_started")
      await waitForAgentRunStartWithTimeout(manager, owner.agentId);
    await manager.waitForDurableSubmittedMessage(owner.agentId, id);
  }
  async stop(): Promise<void> {
    this.unsubscribe();
    await Promise.allSettled([this.runtime.stop(), this.ready]);
  }
}
