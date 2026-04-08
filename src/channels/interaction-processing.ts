import { AgentService, type AgentSessionTarget } from "../agents/agent-service.ts";
import {
  parseAgentCommand,
  renderAgentControlSlashHelp,
  type CommandPrefixes,
} from "../agents/commands.ts";
import {
  formatFollowUpTtlMinutes,
  type FollowUpConfig,
} from "../agents/follow-up-policy.ts";
import {
  renderChannelSnapshot,
  escapeCodeFence,
} from "../shared/transcript.ts";
import {
  buildRenderedMessageState,
  formatChannelFollowUpStatus,
  renderPlatformInteraction,
  type ChannelRenderedMessageState,
} from "./rendering.ts";
import {
  canUsePrivilegeCommands,
  type PrivilegeCommandsConfig,
} from "./privilege-commands.ts";
import { renderPrivilegeCommandHelpLines } from "./privilege-help.ts";

export type ChannelInteractionRoute = {
  agentId: string;
  privilegeCommands: PrivilegeCommandsConfig;
  commandPrefixes: CommandPrefixes;
  streaming: "off" | "latest" | "all";
  response: "all" | "final";
  followUp: FollowUpConfig;
};

export type ChannelInteractionIdentity = {
  platform: "slack" | "telegram";
  conversationKind: "dm" | "channel" | "group" | "topic";
  senderId?: string;
  channelId?: string;
  chatId?: string;
  threadTs?: string;
  topicId?: string;
};

type PostText<TChunk> = (text: string) => Promise<TChunk[]>;
type ReconcileText<TChunk> = (chunks: TChunk[], text: string) => Promise<TChunk[]>;

function renderSensitiveCommandDisabledMessage() {
  return [
    "Privilege commands are not allowed for this route or user.",
    "Enable `privilegeCommands.enabled` on the route to allow transcript and bash commands. Use `privilegeCommands.allowUsers` to restrict access to specific user ids.",
  ].join("\n");
}

function renderWhoAmIMessage(params: {
  identity: ChannelInteractionIdentity;
  route: ChannelInteractionRoute;
  sessionTarget: AgentSessionTarget;
}) {
  const lines = [
    "Who am I",
    "",
    `platform: \`${params.identity.platform}\``,
    `conversationKind: \`${params.identity.conversationKind}\``,
    `agentId: \`${params.route.agentId}\``,
    `sessionKey: \`${params.sessionTarget.sessionKey}\``,
  ];

  if (params.identity.senderId) {
    lines.push(`senderId: \`${params.identity.senderId}\``);
  }

  if (params.identity.channelId) {
    lines.push(`channelId: \`${params.identity.channelId}\``);
  }

  if (params.identity.chatId) {
    lines.push(`chatId: \`${params.identity.chatId}\``);
  }

  if (params.identity.threadTs) {
    lines.push(`threadTs: \`${params.identity.threadTs}\``);
  }

  if (params.identity.topicId) {
    lines.push(`topicId: \`${params.identity.topicId}\``);
  }

  lines.push(
    `privilegeCommands.enabled: \`${params.route.privilegeCommands.enabled}\``,
    `privilegeCommands.allowUsers: \`${
      params.route.privilegeCommands.allowUsers.join(", ") || "(all users on route)"
    }\``,
  );

  return lines.join("\n");
}

function renderRouteStatusMessage(params: {
  identity: ChannelInteractionIdentity;
  route: ChannelInteractionRoute;
  sessionTarget: AgentSessionTarget;
  followUpState: {
    overrideMode?: "auto" | "mention-only" | "paused";
    lastBotReplyAt?: number;
  };
}) {
  const lines = [
    "muxbot status",
    "",
    `platform: \`${params.identity.platform}\``,
    `conversationKind: \`${params.identity.conversationKind}\``,
    `agentId: \`${params.route.agentId}\``,
    `sessionKey: \`${params.sessionTarget.sessionKey}\``,
  ];

  if (params.identity.senderId) {
    lines.push(`senderId: \`${params.identity.senderId}\``);
  }
  if (params.identity.channelId) {
    lines.push(`channelId: \`${params.identity.channelId}\``);
  }
  if (params.identity.chatId) {
    lines.push(`chatId: \`${params.identity.chatId}\``);
  }
  if (params.identity.threadTs) {
    lines.push(`threadTs: \`${params.identity.threadTs}\``);
  }
  if (params.identity.topicId) {
    lines.push(`topicId: \`${params.identity.topicId}\``);
  }

  lines.push(
    `followUp.mode: \`${params.followUpState.overrideMode ?? params.route.followUp.mode}\``,
    `followUp.windowMinutes: \`${formatFollowUpTtlMinutes(params.route.followUp.participationTtlMs)}\``,
    `privilegeCommands.enabled: \`${params.route.privilegeCommands.enabled}\``,
    `privilegeCommands.allowUsers: \`${
      params.route.privilegeCommands.allowUsers.join(", ") || "(all users on route)"
    }\``,
  );

  lines.push(
    "",
    "Useful commands:",
    "- `/help`",
    "- `/whoami`",
    "- `/status`",
    "- `/followup status`",
    "- `/transcript` and `/bash` require privilege commands",
  );

  lines.push("", ...renderPrivilegeCommandHelpLines(params.identity));
  return lines.join("\n");
}

export async function processChannelInteraction<TChunk>(params: {
  agentService: AgentService;
  sessionTarget: AgentSessionTarget;
  identity: ChannelInteractionIdentity;
  senderId?: string;
  text: string;
  route: ChannelInteractionRoute;
  maxChars: number;
  postText: PostText<TChunk>;
  reconcileText: ReconcileText<TChunk>;
}) {
  let responseChunks: TChunk[] = [];
  let renderedState: ChannelRenderedMessageState | undefined;
  const slashCommand = parseAgentCommand(params.text, {
    commandPrefixes: params.route.commandPrefixes,
  });
  const isSensitiveCommand =
    slashCommand?.type === "bash" ||
    (slashCommand?.type === "control" && slashCommand.name === "transcript");

  if (
    isSensitiveCommand &&
    !canUsePrivilegeCommands({
      config: params.route.privilegeCommands,
      userId: params.senderId,
    })
  ) {
    await params.postText(renderSensitiveCommandDisabledMessage());
    await params.agentService.recordConversationReply(params.sessionTarget);
    return;
  }

  if (slashCommand?.type === "control") {
    if (slashCommand.name === "start" || slashCommand.name === "status") {
      const followUpState =
        await params.agentService.getConversationFollowUpState(params.sessionTarget);
      await params.postText(
        renderRouteStatusMessage({
          identity: params.identity,
          route: params.route,
          sessionTarget: params.sessionTarget,
          followUpState,
        }),
      );
      await params.agentService.recordConversationReply(params.sessionTarget);
      return;
    }

    if (slashCommand.name === "help") {
      await params.postText(renderAgentControlSlashHelp());
      await params.agentService.recordConversationReply(params.sessionTarget);
      return;
    }

    if (slashCommand.name === "whoami") {
      await params.postText(
        renderWhoAmIMessage({
          identity: params.identity,
          route: params.route,
          sessionTarget: params.sessionTarget,
        }),
      );
      await params.agentService.recordConversationReply(params.sessionTarget);
      return;
    }

    if (slashCommand.name === "transcript") {
      const transcript = await params.agentService.captureTranscript(params.sessionTarget);
      await params.postText(
        renderChannelSnapshot({
          agentId: transcript.agentId,
          sessionName: transcript.sessionName,
          workspacePath: transcript.workspacePath,
          status: "completed",
          snapshot: transcript.snapshot || "(no tmux output yet)",
          maxChars: params.maxChars,
          note: "transcript command",
        }),
      );
      return;
    }

    if (slashCommand.name === "stop") {
      const stopped = await params.agentService.interruptSession(params.sessionTarget);
      await params.postText(
        stopped.interrupted
          ? `Interrupted agent \`${stopped.agentId}\` session \`${stopped.sessionName}\`.`
          : `Agent \`${stopped.agentId}\` session \`${stopped.sessionName}\` was not running.`,
      );
      await params.agentService.recordConversationReply(params.sessionTarget);
      return;
    }

    if (slashCommand.name === "followup") {
      if (slashCommand.action === "status") {
        const latestState =
          await params.agentService.getConversationFollowUpState(params.sessionTarget);
        await params.postText(
          formatChannelFollowUpStatus({
            defaultMode: params.route.followUp.mode,
            participationTtlMs: params.route.followUp.participationTtlMs,
            overrideMode: latestState.overrideMode,
            lastBotReplyAt: latestState.lastBotReplyAt,
          }),
        );
      } else if (slashCommand.action === "resume") {
        await params.agentService.resetConversationFollowUpMode(params.sessionTarget);
        await params.postText(
          "Follow-up policy reset to route defaults for this conversation.",
        );
      } else if (slashCommand.mode) {
        await params.agentService.setConversationFollowUpMode(
          params.sessionTarget,
          slashCommand.mode,
        );
        await params.postText(
          slashCommand.mode === "paused"
            ? "Follow-up paused for this conversation until the next explicit mention."
            : `Follow-up mode set to \`${slashCommand.mode}\` for this conversation.`,
        );
      }
      await params.agentService.recordConversationReply(params.sessionTarget);
      return;
    }
  }

  if (slashCommand?.type === "bash") {
    if (!slashCommand.command.trim()) {
      await params.postText("Usage: `/bash <command>` or a configured bash shortcut such as `!<command>`");
      return;
    }

    const result = await params.agentService.runShellCommand(
      params.sessionTarget,
      slashCommand.command,
    );
    const header = [
      `Bash in \`${result.workspacePath}\``,
      `command: \`${result.command}\``,
      result.timedOut ? "exit: `124` timed out" : `exit: \`${result.exitCode}\``,
    ].join("\n");
    const body = result.output
      ? `\n\n\`\`\`text\n${escapeCodeFence(result.output)}\n\`\`\``
      : "\n\n`(no output)`";
    await params.postText(`${header}${body}`);
    await params.agentService.recordConversationReply(params.sessionTarget);
    return;
  }

  let replyRecorded = false;
  let renderChain = Promise.resolve();

  const recordReplyIfNeeded = async () => {
    if (replyRecorded) {
      return;
    }

    await params.agentService.recordConversationReply(params.sessionTarget);
    replyRecorded = true;
  };

  const renderResponseText = async (nextText: string) => {
    if (!responseChunks.length) {
      responseChunks = await params.postText(nextText);
      if (responseChunks.length > 0) {
        await recordReplyIfNeeded();
      }
      return;
    }

    responseChunks = await params.reconcileText(responseChunks, nextText);
  };

  try {
    const { positionAhead, result } = params.agentService.enqueuePrompt(
      params.sessionTarget,
      params.text,
      {
        onUpdate: async (update) => {
          if (params.route.streaming === "off") {
            return;
          }

          await (renderChain = renderChain.then(async () => {
            const nextState = buildRenderedMessageState({
              platform: params.identity.platform,
              status: update.status,
              snapshot: update.snapshot,
              queuePosition: positionAhead,
              maxChars: Number.POSITIVE_INFINITY,
              previousState: renderedState,
              responsePolicy: params.route.response,
            });
            if (renderedState?.text === nextState.text) {
              return;
            }

            if (!responseChunks.length) {
              return;
            }

            await renderResponseText(nextState.text);
            renderedState = nextState;
          }));
        },
      },
    );

    if (params.route.streaming !== "off") {
      const placeholderText = renderPlatformInteraction({
        platform: params.identity.platform,
        status: positionAhead > 0 ? "queued" : "running",
        content: "",
        queuePosition: positionAhead,
        maxChars: Number.POSITIVE_INFINITY,
        note:
          positionAhead > 0
            ? "Waiting for the agent queue to clear."
            : "Working...",
      });
      responseChunks = await params.postText(placeholderText);
      await recordReplyIfNeeded();
      renderedState = {
        text: placeholderText,
        body: "",
      };
    }

    const finalResult = await result;
    await renderChain;
    const nextState = buildRenderedMessageState({
      platform: params.identity.platform,
      status: finalResult.status,
      snapshot: finalResult.snapshot,
      maxChars: Number.POSITIVE_INFINITY,
      previousState: renderedState,
      responsePolicy: params.route.response,
    });

    if (params.route.streaming === "off") {
      await params.postText(
        renderPlatformInteraction({
          platform: params.identity.platform,
          status: finalResult.status,
          content: nextState.body,
          maxChars: Number.POSITIVE_INFINITY,
          responsePolicy: "final",
        }),
      );
      await recordReplyIfNeeded();
      renderedState = nextState;
      return;
    }

    await renderResponseText(nextState.text);
    renderedState = nextState;
  } catch (error) {
    const errorText = renderPlatformInteraction({
      platform: params.identity.platform,
      status: "error",
      content: String(error),
      maxChars: Number.POSITIVE_INFINITY,
    });
    if (params.route.streaming !== "off" && responseChunks.length > 0) {
      await params.reconcileText(responseChunks, errorText);
    } else {
      await params.postText(errorText);
    }
    throw error;
  }
}
