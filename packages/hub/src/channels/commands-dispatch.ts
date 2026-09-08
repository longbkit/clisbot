import { runExtensionCommand } from "./commands-extension.js";
import { APPROVAL_PRIVILEGES } from "../access/contract.js";
import type { ChannelStore } from "../db/channels.js";
import type { CompiledChannelAccount, CompiledRoute } from "./config/compile.js";
import type { DaemonConnection } from "./daemon/client.js";
import type { AgentSnapshot, CreateAgentConfig } from "./daemon/types.js";
import type { ChannelPlaneDeps, InboundMessage } from "./plane/types.js";
import { deriveBindingKey } from "./bindings/index.js";
import {
  channelCommandPrivilege,
  channelCommandSpec,
  textCommandHelpText,
  type ChannelTextCommand,
} from "./commands.js";
import {
  commandAccessRequest,
  channelIdentityText,
  channelSessionLink,
} from "./commands-context.js";
import {
  runConfigurationCommand,
  resolveConversationConfiguration,
  validateAgentConfigurationAuthority,
} from "./commands-config.js";
import type { ChannelLifecycleCommands, LifecycleCommandContext } from "./commands-lifecycle.js";

export interface CommandDispatcherDependencies {
  plane: ChannelPlaneDeps;
  daemon: DaemonConnection;
  store: ChannelStore;
  lifecycle: ChannelLifecycleCommands;
  pendingApprovals(agentId: string): number;
  dispatchPrompt(context: LifecycleCommandContext, prompt: string): Promise<boolean>;
}
export interface CommandResult {
  handled: boolean;
  detail: string;
}

/** Platform commands target the route's execution owner after one Access check. */
export class ChannelCommandDispatcher {
  constructor(private readonly deps: CommandDispatcherDependencies) {}

  async handle(
    command: ChannelTextCommand,
    context: LifecycleCommandContext,
  ): Promise<CommandResult> {
    const refusal = await this.authorize(command, context);
    if (refusal) {
      await context.post(refusal);
      return { handled: false, detail: refusal };
    }
    if (!context.message.externalMessageId || !isMutation(command))
      return this.executeAuthorized(command, context);
    const key = {
      organizationId: this.deps.plane.organizationId,
      channel: context.message.channel,
      accountId: context.account.accountId,
      externalConversationId: context.message.conversation.rootConversationId,
    };
    const receipt = await this.deps.store.access.beginCommand(
      key,
      context.message.externalMessageId,
      command.name,
    );
    if (!receipt.claimed) {
      const detail =
        receipt.status === "pending"
          ? "An earlier attempt is in progress or was interrupted. Inspect the session before retrying with a new message."
          : `/${command.name} was already processed for this message.`;
      await context.post(detail).catch(() => false);
      return { handled: true, detail: "duplicate command consumed" };
    }
    const result = await this.executeAuthorized(command, context);
    await this.deps.store.access.completeCommand(key, context.message.externalMessageId, result);
    return result;
  }

  private async executeAuthorized(
    command: ChannelTextCommand,
    context: LifecycleCommandContext,
  ): Promise<CommandResult> {
    try {
      if (command.name === "help")
        return this.reply(context, textCommandHelpText(context.route.target.kind), "help");
      if (command.name === "me")
        return this.reply(
          context,
          await channelIdentityText(
            this.deps.plane,
            context.message,
            context.account,
            context.route,
          ),
          "me",
        );
      if (context.route.target.kind === "workflow") return this.workflow(command, context);
      const lifecycle = await this.deps.lifecycle.handle(command, context);
      if (lifecycle) return lifecycle;
      if (["agent", "provider", "model", "effort", "permission"].includes(command.name)) {
        return this.configuration(
          command as Parameters<typeof runConfigurationCommand>[0]["command"],
          context,
        );
      }
      if (command.name === "skill" || command.name === "command")
        return this.extension(command, context);
      return this.session(command, context);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Command failed.";
      await context.post(detail);
      return { handled: false, detail };
    }
  }

  private async authorize(
    command: ChannelTextCommand,
    context: LifecycleCommandContext,
  ): Promise<string | undefined> {
    if (context.route.target.kind === "workflow" && channelCommandSpec(command.name).directOnly) {
      return `/${command.name} is not available on an automation route.`;
    }
    if (context.route.target.kind === "workflow") return undefined;
    const privilege = channelCommandPrivilege(command);
    if (privilege === null) return undefined;
    const { plane } = this.deps;
    const request = commandAccessRequest(
      plane,
      context.message,
      context.account,
      context.route,
      privilege,
      context.accessTarget,
    );
    const allowed = await plane.commandAccess?.authorizeChannelPrivilege(request);
    if (!allowed?.allowed) return `/${command.name} requires ${privilege} access here.`;
    return undefined;
  }

  async resolveConfig(
    context: LifecycleCommandContext,
    capability?: import("./plane/types.js").ChannelReplyAgentCapability,
    validate = true,
  ): Promise<CreateAgentConfig> {
    const { message, account, route } = context;
    if (route.target.kind !== "agent") throw new Error("A direct route is required.");
    const selection = await this.deps.store.access.findConversationSelection(
      this.selectionKey(context),
    );
    const defaults =
      capability === undefined && route.defaults.outbound.path === "tool"
        ? { ...route.defaults, outbound: { ...route.defaults.outbound, path: "relay" as const } }
        : route.defaults;
    const base = this.deps.plane.resolveAgentSpec(
      route.target,
      defaults,
      {
        channel: message.channel,
        accountId: account.accountId,
        ...deriveBindingKey(message, route),
      },
      capability,
    );
    const config = resolveConversationConfiguration(base, selection);
    if (validate) {
      const decision = await this.authorizeConfiguration({ ...context, config });
      if (!decision.allowed) throw new Error(decision.reason);
    }
    return config;
  }

  async authorizeConfiguration(input: {
    message: InboundMessage;
    account: CompiledChannelAccount;
    route: CompiledRoute;
    config: CreateAgentConfig;
  }): Promise<{ allowed: boolean; reason?: string }> {
    const request = commandAccessRequest(
      this.deps.plane,
      input.message,
      input.account,
      input.route,
      "agent.create",
    );
    const access = await this.deps.plane.commandAccess?.resolveChannelAgentConfigurations(request);
    if (!access) return { allowed: false, reason: "Agent configuration access is unavailable." };
    const checks = await Promise.all(
      APPROVAL_PRIVILEGES.map((privilege) =>
        this.deps.plane.commandAccess?.authorizeChannelPrivilege({ ...request, privilege }),
      ),
    );
    try {
      await validateAgentConfigurationAuthority(
        this.deps.daemon,
        input.config,
        access,
        checks.every((entry) => entry?.allowed),
        (
          await this.deps.plane.commandAccess?.authorizeChannelPrivilege({
            ...request,
            privilege: "agent.fast.use",
          })
        )?.allowed === true,
      );
      return { allowed: true };
    } catch (error) {
      return {
        allowed: false,
        reason: error instanceof Error ? error.message : "Agent configuration was refused.",
      };
    }
  }

  async authorizeResume(agent: AgentSnapshot, context: LifecycleCommandContext): Promise<boolean> {
    const config = await this.resolveConfig(context, undefined, false);
    if (config.projectId !== undefined) {
      if (!(await this.deps.daemon.isAgentInProject(agent, config.projectId))) return false;
    } else if (agent.cwd !== config.cwd) return false;
    const request = commandAccessRequest(
      this.deps.plane,
      context.message,
      context.account,
      context.route,
      "agent.interact",
      context.accessTarget,
    );
    if (!(await this.deps.plane.commandAccess?.authorizeChannelPrivilege(request))?.allowed)
      return false;
    if (!(await this.mayUseLiveMode(agent, context))) return false;
    return (
      await this.authorizeConfiguration({
        ...context,
        config: snapshotConfiguration(config, agent),
      })
    ).allowed;
  }

  private async mayUseLiveMode(
    agent: AgentSnapshot,
    context: LifecycleCommandContext,
  ): Promise<boolean> {
    return agent.modeId !== undefined || (await this.canSuppressApprovals(context));
  }

  private async canSuppressApprovals(context: LifecycleCommandContext): Promise<boolean> {
    const request = commandAccessRequest(
      this.deps.plane,
      context.message,
      context.account,
      context.route,
      "agent.interact",
      context.accessTarget,
    );
    const checks = await Promise.all(
      APPROVAL_PRIVILEGES.map((privilege) =>
        this.deps.plane.commandAccess?.authorizeChannelPrivilege({ ...request, privilege }),
      ),
    );
    return checks.every((entry) => entry?.allowed);
  }

  private selectionKey({ message, account, route }: LifecycleCommandContext) {
    return {
      organizationId: this.deps.plane.organizationId,
      channel: message.channel,
      accountId: account.accountId,
      ...deriveBindingKey(message, route),
    };
  }

  private async configuration(
    command: Parameters<typeof runConfigurationCommand>[0]["command"],
    context: LifecycleCommandContext,
  ): Promise<CommandResult> {
    const response = await runConfigurationCommand(await this.configurationInput(command, context));
    if (response.selection) {
      await this.deps.store.access.setConversationSelection(this.selectionKey(context), {
        ...response.selection,
        selectedBy: context.message.senderIdentity,
      });
    }
    return this.reply(
      context,
      response.remint && context.agentId
        ? `${response.text} Provider staged; /new starts fresh, /fork carries this conversation's context.`
        : response.text,
    );
  }

  private async configurationInput(
    command: Parameters<typeof runConfigurationCommand>[0]["command"],
    context: LifecycleCommandContext,
  ): Promise<Parameters<typeof runConfigurationCommand>[0]> {
    const request = commandAccessRequest(
      this.deps.plane,
      context.message,
      context.account,
      context.route,
      "agent.interact",
      context.accessTarget,
    );
    const access = await this.deps.plane.commandAccess?.resolveChannelAgentConfigurations(request);
    if (!access) throw new Error("Agent configuration access is unavailable.");
    const config = await this.resolveConfig(context, undefined, false);
    const boundAgent = context.agentId
      ? (await this.deps.daemon.listAgents()).find((entry) => entry.id === context.agentId)
      : undefined;
    const agent = boundAgent?.provider === config.provider ? boundAgent : undefined;
    if (
      agent &&
      command.value &&
      !/^(list|search)(?:\s|$)/iu.test(command.value) &&
      command.name !== "permission" &&
      !(await this.mayUseLiveMode(agent, context))
    ) {
      throw new Error(
        "The current session mode is unavailable. Select an explicit /permission mode before changing its configuration.",
      );
    }
    const fastAccess = await this.deps.plane.commandAccess?.authorizeChannelPrivilege({
      ...request,
      privilege: "agent.fast.use",
    });
    return {
      command,
      daemon: this.deps.daemon,
      config: agent ? snapshotConfiguration(config, agent) : config,
      ...(boundAgent
        ? {
            agentId: boundAgent.id,
            activeProvider: boundAgent.provider,
            activeConfiguration: snapshotConfiguration(config, boundAgent),
          }
        : {}),
      access,
      canSuppressApprovals: await this.canSuppressApprovals(context),
      canUseFastMode: fastAccess?.allowed === true,
    };
  }

  private async extension(
    command: Extract<ChannelTextCommand, { name: "skill" | "command" }>,
    context: LifecycleCommandContext,
  ): Promise<CommandResult> {
    const response = await runExtensionCommand({
      command,
      daemon: this.deps.daemon,
      ...(context.agentId ? { agentId: context.agentId } : {}),
      store: this.deps.store.access,
      key: this.selectionKey(context),
      senderIdentity: context.message.senderIdentity,
      canManageCommands:
        (
          await this.deps.plane.commandAccess?.authorizeChannelPrivilege(
            commandAccessRequest(
              this.deps.plane,
              context.message,
              context.account,
              context.route,
              "approval.config",
              context.accessTarget,
            ),
          )
        )?.allowed === true,
    });
    if (response.prompt !== undefined) {
      const handled = await this.deps.dispatchPrompt(context, response.prompt);
      return {
        handled,
        detail: handled ? "Command sent to the agent." : "The agent did not accept the command.",
      };
    }
    return this.reply(context, response.text ?? "No commands available.");
  }

  private async session(
    command: ChannelTextCommand,
    context: LifecycleCommandContext,
  ): Promise<CommandResult> {
    if (!context.agentId)
      return this.reply(context, "No agent session is bound to this conversation yet.");
    if (command.name === "stop") {
      this.deps.lifecycle.forget(context.agentId);
      await this.deps.daemon.cancelAgent(context.agentId);
      return this.reply(context, "Stop requested — the running turn is being interrupted.");
    }
    const agent = (await this.deps.daemon.listAgents()).find(
      (entry) => entry.id === context.agentId,
    );
    if (!agent) return this.reply(context, "The bound agent is unavailable.");
    const link = channelSessionLink(
      this.deps.daemon.getServerInfo?.()?.serverId,
      agent.id,
      this.deps.plane.appWebUrl,
    );
    if (command.name === "cowork")
      return this.reply(context, link ?? "The host has not provided a session link yet.", "cowork");
    if (command.name === "status") return this.reply(context, this.status(agent, link), "status");
    return this.reply(context, `/${command.name} is unavailable.`);
  }

  private status(agent: AgentSnapshot, link?: string): string {
    const used = agent.contextWindowUsedTokens;
    const max = agent.contextWindowMaxTokens;
    return [
      `Agent: ${agent.title || agent.id} (${agent.provider})`,
      `Session: ${agent.id}`,
      `Status: ${agent.status}`,
      `Model: ${agent.model ?? "default"}`,
      `Working directory: ${agent.cwd}`,
      ...(typeof used === "number" && typeof max === "number" && max > 0
        ? [`Context left: ${Math.max(0, max - used)} / ${max} tokens`]
        : []),
      `Pending approvals: ${this.deps.pendingApprovals(agent.id)}`,
      ...(link ? [link] : []),
    ].join("\n");
  }

  private async workflow(
    command: ChannelTextCommand,
    context: LifecycleCommandContext,
  ): Promise<CommandResult> {
    const { message, route, account } = context;
    if (route.target.kind !== "workflow") throw new Error("An automation route is required.");
    const key = deriveBindingKey(message, route);
    const input = {
      organizationId: this.deps.plane.organizationId,
      bindingKey: JSON.stringify([
        message.channel,
        message.accountId,
        key.externalConversationId,
        key.externalThreadId,
      ]),
      workflowName: route.target.workflow,
      authorization: commandAccessRequest(
        this.deps.plane,
        message,
        account,
        route,
        "agent.interact",
      ),
    };
    if (command.name === "stop") {
      if (!this.deps.plane.cancelWorkflowRuns)
        throw new Error("Automation cancellation is unavailable.");
      const count = await this.deps.plane.cancelWorkflowRuns(input);
      return this.reply(context, `Stop requested for ${count} active automation run(s).`);
    }
    if (!this.deps.plane.readWorkflowRuns) throw new Error("Automation status is unavailable.");
    const runs = await this.deps.plane.readWorkflowRuns(input);
    return this.reply(context, workflowRunsText(runs, this.deps.plane.appWebUrl), command.name);
  }

  private async reply(
    context: LifecycleCommandContext,
    text: string,
    detail = "command reply",
  ): Promise<CommandResult> {
    const handled = await context.post(text);
    return { handled, detail: handled ? detail : `${detail} reply not delivered` };
  }
}

function isMutation(command: ChannelTextCommand): boolean {
  if (["help", "me", "status", "cowork"].includes(command.name)) return false;
  if (
    ["agent", "provider", "model", "effort", "permission", "skill", "command"].includes(
      command.name,
    )
  ) {
    return command.value !== undefined && !/^(list|search)(?:\s|$)/iu.test(command.value);
  }
  return true;
}

function snapshotConfiguration(base: CreateAgentConfig, agent: AgentSnapshot): CreateAgentConfig {
  const {
    model: _model,
    thinkingOptionId: _thinking,
    modeId: _mode,
    featureValues: _features,
    ...location
  } = base;
  return {
    ...location,
    provider: agent.provider,
    cwd: agent.cwd,
    ...(agent.model === undefined ? {} : { model: agent.model }),
    ...(agent.thinkingOptionId === undefined ? {} : { thinkingOptionId: agent.thinkingOptionId }),
    ...(agent.modeId === undefined ? {} : { modeId: agent.modeId }),
    ...(agent.featureValues === undefined ? {} : { featureValues: agent.featureValues }),
  };
}

function workflowRunsText(
  runs: import("../workflows/channel-status.js").ChannelWorkflowRunSummary[],
  appWebUrl?: string,
): string {
  if (runs.length === 0) return "No active automation runs in this conversation.";
  return runs
    .map((run) =>
      [
        `Run: ${run.id} (${run.status})`,
        ...run.steps.map((step) => {
          const link = step.agentId
            ? channelSessionLink(step.serverId, step.agentId, appWebUrl)
            : undefined;
          return `${step.id}: ${step.status}${link ? `\n${link}` : ""}`;
        }),
      ].join("\n"),
    )
    .join("\n\n");
}
