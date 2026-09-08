import { randomUUID } from "node:crypto";
import type { ChannelStore } from "../db/channels.js";
import type { ThreadBindingRecord } from "../db/types.js";
import { bindingSummary, deriveBindingKey, routePosition } from "./bindings/index.js";
import type { CompiledChannelAccount, CompiledRoute } from "./config/compile.js";
import type { DaemonConnection } from "./daemon/client.js";
import type { AgentSnapshot, CreateAgentConfig } from "./daemon/types.js";
import type { ChannelReplyAgentCapability, InboundMessage } from "./plane/types.js";
import { ChannelCommandTurnQueue } from "./commands-lifecycle-queue.js";

export interface LifecycleCommandContext {
  message: InboundMessage;
  account: CompiledChannelAccount;
  route: CompiledRoute;
  agentId?: string | undefined;
  accessTarget?: import("./plane/types.js").ChannelAgentAccessTarget;
  post(text: string): Promise<boolean>;
}

export interface LifecycleCommandDependencies {
  organizationId: string;
  channelRevisionId?: string | null;
  daemon: DaemonConnection;
  store: Pick<ChannelStore, "findThreadBinding" | "rebindThreadBinding" | "releaseThreadBinding">;
  resolveConfig(
    context: LifecycleCommandContext,
    capability?: ChannelReplyAgentCapability,
  ): Promise<CreateAgentConfig>;
  issueCapability?(context: LifecycleCommandContext): ChannelReplyAgentCapability;
  bindCapability?(token: string, agentId: string): boolean;
  revokeCapability?(token: string): void;
  attach(binding: ThreadBindingRecord, context: LifecycleCommandContext): Promise<void>;
  detach(agentId: string): Promise<void>;
  authorizeResume(agent: AgentSnapshot, context: LifecycleCommandContext): Promise<boolean>;
  authorizeQueued?(context: LifecycleCommandContext): Promise<boolean>;
  dispatchFresh(context: LifecycleCommandContext): Promise<boolean>;
}

interface BindingChange {
  binding: ThreadBindingRecord;
  previous: ThreadBindingRecord | undefined;
  context: LifecycleCommandContext;
}

const COMMANDS = new Set(["new", "resume", "fork", "side", "quick", "steer", "queue"]);

/** Direct session commands. The caller gates org Access before entering this handler. */
export class ChannelLifecycleCommands {
  private readonly queue: ChannelCommandTurnQueue;
  private readonly oneOffs = new Map<string, LifecycleCommandContext>();

  constructor(private readonly deps: LifecycleCommandDependencies) {
    this.queue = new ChannelCommandTurnQueue(deps.daemon);
  }

  async handle(
    command: { name: string; value?: string },
    context: LifecycleCommandContext,
  ): Promise<{ handled: boolean; detail: string } | undefined> {
    if (!COMMANDS.has(command.name)) return undefined;
    if (context.route.target.kind !== "agent") {
      return this.reply(context, "This command is not available on an automation route.");
    }
    try {
      const detail = await this.execute(command, context);
      return this.reply(context, detail);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Session command failed.";
      await context.post(detail);
      return { handled: false, detail };
    }
  }

  private async execute(
    command: { name: string; value?: string },
    context: LifecycleCommandContext,
  ) {
    const prompt = command.value?.trim();
    if (command.name === "new") return this.fresh(context, prompt);
    if (command.name === "resume") return this.resume(context, prompt);
    if (command.name === "steer" || command.name === "queue") {
      return this.turnCommand(command.name, context, prompt);
    }
    return this.create(command.name, context, prompt);
  }

  private async reply(context: LifecycleCommandContext, detail: string) {
    const delivered = await context.post(detail).catch(() => false);
    return {
      handled: true,
      detail: delivered ? detail : `${detail} (Acknowledgement was not delivered.)`,
    };
  }

  private async fresh(context: LifecycleCommandContext, prompt?: string): Promise<string> {
    const key = deriveBindingKey(context.message, context.route);
    if (context.agentId !== undefined) await this.deps.daemon.cancelAgent(context.agentId);
    const released = await this.deps.store.releaseThreadBinding({
      organizationId: this.deps.organizationId,
      accountId: context.account.accountId,
      ...key,
    });
    if (released?.agentId) await this.detach(released.agentId);
    if (prompt !== undefined && prompt !== "") {
      const accepted = await this.deps.dispatchFresh({
        ...context,
        agentId: undefined,
        message: { ...context.message, text: prompt, mentionedBot: true },
      });
      if (!accepted) throw new Error("The fresh session did not accept its first prompt.");
      return "Started a fresh session with your message.";
    }
    return "Session cleared. Your next message starts a fresh session.";
  }

  private async resume(context: LifecycleCommandContext, agentId?: string): Promise<string> {
    if (!agentId || /\s/.test(agentId)) throw new Error("Usage: /resume <id>");
    const agent = (await this.deps.daemon.listAgents()).find((entry) => entry.id === agentId);
    // Deliberately use the same answer for nonexistent and unauthorized sessions.
    if (agent === undefined || !(await this.deps.authorizeResume(agent, context))) {
      throw new Error("That session is unavailable or you do not have access to it here.");
    }
    if (agent.id === context.agentId) return `Session ${agent.id} is already bound here.`;
    const change = await this.prepareRebind(
      agent.id,
      context,
      context.route.defaults.outbound.path === "tool",
    );
    try {
      await this.deps.attach(change.binding, change.context);
    } catch (error) {
      await this.rollbackRebind(change);
      throw error;
    }
    await this.finalizeRebind(change);
    return `Resumed session ${agent.id} in this conversation.`;
  }

  private async turnCommand(
    name: "steer" | "queue",
    context: LifecycleCommandContext,
    prompt?: string,
  ) {
    if (!prompt) throw new Error(`Usage: /${name} <message>`);
    if (!context.agentId) throw new Error("No bound session. Start one with /new <message>.");
    const agent = (await this.deps.daemon.listAgents()).find(
      (entry) => entry.id === context.agentId,
    );
    if (agent === undefined) throw new Error("The bound session is unavailable.");
    if (name === "steer") {
      if (agent.status !== "running") throw new Error("There is no running turn to steer.");
      await this.deps.daemon.sendAgentMessage(agent.id, prompt, { steer: true });
      return "Message admitted into the running turn.";
    }
    await this.queue.enqueue(
      agent.id,
      prompt,
      agent.status === "running",
      context.post,
      () => this.deps.authorizeQueued?.(context) ?? Promise.resolve(false),
    );
    return agent.status === "running"
      ? "Message queued until the current turn ends."
      : "Queued message sent.";
  }

  private async forkAttachments(name: string, context: LifecycleCommandContext) {
    if (name === "quick") return undefined;
    if (!context.agentId) throw new Error("No bound session to fork.");
    if (
      this.deps.daemon.getServerInfo?.()?.features?.["agentForkContext"] !== true ||
      this.deps.daemon.buildAgentForkContext === undefined
    ) {
      throw new Error("This host does not support session forks.");
    }
    const fork = await this.deps.daemon.buildAgentForkContext(context.agentId);
    return fork.attachment === null ? undefined : [fork.attachment];
  }

  private async create(
    name: string,
    context: LifecycleCommandContext,
    prompt?: string,
  ): Promise<string> {
    const oneOff = name !== "fork";
    if (oneOff && !prompt) throw new Error(`Usage: /${name} <message>`);
    const attachments = await this.forkAttachments(name, context);
    // One-offs have their own relay association and never inherit a bound Agent's tool capability.
    const outputContext = oneOff ? this.relayContext(context) : context;
    const capability = this.capabilityFor(outputContext);
    const created = await this.createConfiguredAgent(name, outputContext, capability, oneOff);
    let change: BindingChange | undefined;
    try {
      if (
        capability !== undefined &&
        this.deps.bindCapability?.(capability.token, created.agentId) !== true
      ) {
        throw new Error("Channel reply capability could not bind to the created session.");
      }
      if (oneOff) await this.attachOneOff(created.agentId, outputContext);
      else {
        change = await this.prepareRebind(created.agentId, context);
        await this.deps.attach(change.binding, change.context);
      }
      // Subscribe before starting: initialPrompt at creation races first-turn stream attachment.
      await this.deps.daemon.sendAgentMessage(
        created.agentId,
        prompt ?? "Continue from the conversation context.",
        {
          steer: true,
          ...(attachments === undefined ? {} : { attachments }),
        },
      );
    } catch (error) {
      await this.deps.daemon.cancelAgent(created.agentId).catch(() => undefined);
      if (capability) this.deps.revokeCapability?.(capability.token);
      if (change) await this.rollbackRebind(change);
      else await this.detach(created.agentId).catch(() => undefined);
      throw error;
    }
    if (change) await this.finalizeRebind(change);
    return oneOff
      ? `Started /${name}; the answer will appear here.`
      : `Forked into session ${created.agentId}.`;
  }

  private capabilityFor(context: LifecycleCommandContext): ChannelReplyAgentCapability | undefined {
    if (context.route.defaults.outbound.path !== "tool") return undefined;
    if (!this.deps.issueCapability || !this.deps.bindCapability || !this.deps.revokeCapability) {
      throw new Error("Channel reply capability is unavailable.");
    }
    return this.deps.issueCapability(context);
  }

  private async createConfiguredAgent(
    name: string,
    context: LifecycleCommandContext,
    capability: ChannelReplyAgentCapability | undefined,
    oneOff: boolean,
  ) {
    try {
      const config = await this.deps.resolveConfig(context, capability);
      return await this.deps.daemon.createAgent(config, {
        title: `Channel /${name}`,
        ...(oneOff ? { autoArchive: true } : {}),
      });
    } catch (error) {
      if (capability) this.deps.revokeCapability?.(capability.token);
      throw error;
    }
  }

  private relayContext(context: LifecycleCommandContext): LifecycleCommandContext {
    return {
      ...context,
      route: {
        ...context.route,
        defaults: {
          ...context.route.defaults,
          outbound: { ...context.route.defaults.outbound, path: "relay" },
          sync: { ...context.route.defaults.sync, finalAnswers: true },
        },
      },
    };
  }

  private async prepareRebind(
    agentId: string,
    context: LifecycleCommandContext,
    forceRelay = false,
  ): Promise<BindingChange> {
    const key = deriveBindingKey(context.message, context.route);
    const previous = await this.deps.store.findThreadBinding(
      this.deps.organizationId,
      context.account.accountId,
      key.externalConversationId,
      key.externalThreadId,
    );
    const binding = await this.deps.store.rebindThreadBinding({
      organizationId: this.deps.organizationId,
      channel: context.message.channel,
      accountId: context.account.accountId,
      ...deriveBindingKey(context.message, context.route),
      expectedAgentId: context.agentId ?? null,
      agentId,
      initiator: context.message.senderIdentity,
      route: {
        ...bindingSummary(
          context.route,
          context.message.conversation,
          {
            revisionId: this.deps.channelRevisionId ?? null,
            position: routePosition(context.account, context.route),
          },
          context.message.conversationLabel,
        ),
        ...(forceRelay ? { commandReplyPath: "relay" } : {}),
      },
    });
    return { binding, previous, context: forceRelay ? this.relayContext(context) : context };
  }

  /** Only release the source after the replacement stream and first prompt are accepted. */
  private async finalizeRebind(change: BindingChange): Promise<void> {
    const agentId = change.previous?.agentId;
    if (!agentId || agentId === change.binding.agentId) return;
    this.forget(agentId);
    await this.deps.daemon.cancelAgent(agentId).catch(() => undefined);
    await this.deps.detach(agentId).catch(() => undefined);
  }

  /** CAS avoids overwriting a later binding decision if recovery races another command. */
  private async rollbackRebind(change: BindingChange): Promise<void> {
    const { binding, previous } = change;
    try {
      if (previous?.agentId) {
        await this.deps.store.rebindThreadBinding({
          organizationId: previous.organizationId,
          channel: previous.channel,
          accountId: previous.accountId,
          externalConversationId: previous.externalConversationId,
          externalThreadId: previous.externalThreadId,
          expectedAgentId: binding.agentId,
          agentId: previous.agentId,
          daemonId: previous.daemonId,
          initiator: previous.initiator,
          route: previous.route,
        });
      } else {
        await this.deps.store.releaseThreadBinding({
          organizationId: binding.organizationId,
          accountId: binding.accountId,
          externalConversationId: binding.externalConversationId,
          externalThreadId: binding.externalThreadId,
          expectedAgentId: binding.agentId ?? undefined,
        });
      }
    } finally {
      if (binding.agentId) await this.detach(binding.agentId).catch(() => undefined);
    }
  }

  private async attachOneOff(agentId: string, context: LifecycleCommandContext): Promise<void> {
    this.oneOffs.set(agentId, context);
    const binding: ThreadBindingRecord = {
      id: randomUUID(),
      organizationId: this.deps.organizationId,
      channel: context.message.channel,
      accountId: context.account.accountId,
      ...deriveBindingKey(context.message, context.route),
      status: "bound",
      pendingExecutionId: null,
      agentId,
      daemonId: null,
      initiator: context.message.senderIdentity,
      route: bindingSummary(context.route, context.message.conversation),
      createdAt: new Date(),
      resolvedAt: new Date(),
    };
    await this.deps.attach(binding, context);
  }

  /** Invoke after the relay consumes the terminal event, so the one-off's answer is delivered first. */
  async onStream(agentId: string, event: unknown): Promise<void> {
    await this.queue.onStream(agentId, event);
    if (this.oneOffs.has(agentId) && isLifecycleTerminal(event)) await this.detach(agentId);
  }

  async detach(agentId: string): Promise<void> {
    this.forget(agentId);
    await this.deps.detach(agentId);
  }

  /** Called by the plane when another command detaches a session. */
  forget(agentId: string): void {
    this.queue.clear(agentId);
    this.oneOffs.delete(agentId);
  }

  stop(): void {
    this.queue.stop();
    this.oneOffs.clear();
  }
}

export function isLifecycleTerminal(event: unknown): boolean {
  if (typeof event !== "object" || event === null) return false;
  const kind =
    (event as { type?: string; kind?: string }).type ?? (event as { kind?: string }).kind;
  return (
    kind !== undefined &&
    ["turn_completed", "turn_failed", "turn_canceled", "turn_closed"].includes(kind)
  );
}
