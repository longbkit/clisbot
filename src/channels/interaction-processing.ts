import {
  ActiveRunInProgressError,
  AgentService,
  type AgentSessionTarget,
  type SessionDiagnostics,
} from "../agents/agent-service.ts";
import { ClearedQueuedTaskError } from "../agents/job-queue.ts";
import {
  parseAgentCommand,
  renderAgentControlSlashHelp,
  renderQueueHelpLines,
  type CommandPrefixes,
} from "../agents/commands.ts";
import {
  formatFollowUpTtlMinutes,
  type FollowUpConfig,
} from "../agents/follow-up-policy.ts";
import {
  FORCE_LOOP_INTERVAL_MS,
  formatCalendarLoopSchedule,
  formatLoopIntervalShort,
  LOOP_APP_FLAG,
  LOOP_FORCE_FLAG,
  MIN_LOOP_INTERVAL_MS,
} from "../agents/loop-command.ts";
import {
  renderLoopStartedMessage as renderManagedLoopStartedMessage,
  renderLoopStatusSchedule as renderManagedLoopStatusSchedule,
  resolveLoopPromptText as resolveManagedLoopPromptText,
  summarizeLoopPrompt as summarizeManagedLoopPrompt,
  validateLoopInterval as validateManagedLoopInterval,
} from "../agents/loop-control-shared.ts";
import {
  renderChannelSnapshot,
  renderCompactChannelTranscript,
  escapeCodeFence,
  resolveDetachedInteractionNote,
} from "../shared/transcript.ts";
import type { ResolvedChannelAuth } from "../auth/resolve.ts";
import {
  buildRenderedMessageState,
  formatChannelFollowUpStatus,
  renderPlatformInteraction,
  type ChannelRenderedMessageState,
} from "./rendering.ts";
import {
  renderQueueStartNotification,
  summarizeSurfaceNotificationText,
  type SurfaceNotificationMode,
  type SurfaceNotificationsConfig,
} from "./surface-notifications.ts";
import { buildSteeringPromptText } from "./agent-prompt.ts";
import type { RunObserverMode, RunUpdate } from "../agents/run-observation.ts";
import {
  getConversationResponseMode,
  setConversationResponseMode,
} from "./response-mode-config.ts";
import {
  getConversationAdditionalMessageMode,
  setConversationAdditionalMessageMode,
} from "./additional-message-mode-config.ts";
import {
  getConversationStreaming,
  setConversationStreaming,
} from "./streaming-config.ts";
import { setScopedConversationFollowUpMode } from "./follow-up-mode-config.ts";
import { logLatencyDebug, type LatencyDebugContext } from "../control/latency-debug.ts";
import { sleep } from "../shared/process.ts";
import { renderCliCommand } from "../shared/cli-name.ts";
import type { ProcessingIndicatorLifecycle } from "./processing-indicator.ts";
import type { ChannelIdentity } from "./channel-identity.ts";
import { resolveChannelIdentityBotId } from "./channel-identity.ts";
import type { StoredLoopSender } from "../agents/loop-state.ts";
import type { SurfacePromptContext } from "./surface-prompt-context.ts";

export type ChannelInteractionRoute = {
  agentId: string;
  commandPrefixes: CommandPrefixes;
  streaming: "off" | "latest" | "all";
  response: "all" | "final";
  responseMode: "capture-pane" | "message-tool";
  additionalMessageMode: "queue" | "steer";
  surfaceNotifications: SurfaceNotificationsConfig;
  verbose: "off" | "minimal";
  followUp: FollowUpConfig;
  timezone?: string;
  botTimezone?: string;
};

export type ChannelInteractionIdentity = ChannelIdentity;

type PostText<TChunk> = (text: string) => Promise<TChunk[]>;
type ReconcileText<TChunk> = (chunks: TChunk[], text: string) => Promise<TChunk[]>;

export type ProcessChannelInteractionResult = {
  processingIndicatorLifecycle: ProcessingIndicatorLifecycle;
};

const MESSAGE_TOOL_FINAL_GRACE_WINDOW_MS = 3_000;
const MESSAGE_TOOL_FINAL_GRACE_POLL_MS = 100;
const MESSAGE_TOOL_PREVIEW_SIGNAL_POLL_MS = 100;
const TRANSCRIPT_PREVIEW_MAX_CHARS = 1200;

function renderSensitiveCommandDisabledMessage() {
  return [
    "Shell execution is not allowed for your current role on this agent.",
    "Ask an app or agent admin to grant `shellExecute` if this surface should allow `/bash`.",
  ].join("\n");
}

function renderTranscriptDisabledMessage() {
  return [
    "Transcript inspection is disabled for this route.",
    'Set `verbose: "minimal"` on the route or channel to allow `/transcript`.',
  ].join("\n");
}

function renderStartupSteeringUnavailableMessage() {
  return [
    "The active run is still starting and cannot accept steering input yet.",
    "Send a normal follow-up message to keep it ordered behind the first prompt, or wait until startup finishes before using `/steer`.",
  ].join("\n");
}

function renderPrincipalFormat(identity: ChannelInteractionIdentity) {
  if (identity.platform === "slack") {
    return "slack:<nativeUserId>";
  }
  return "telegram:<nativeUserId>";
}

function renderPrincipalExample(identity: ChannelInteractionIdentity) {
  if (identity.senderId) {
    return `${identity.platform}:${identity.senderId}`;
  }

  if (identity.platform === "slack") {
    return "slack:U123ABC456";
  }

  return "telegram:1276408333";
}

function renderWhoAmIMessage(params: {
  identity: ChannelInteractionIdentity;
  route: ChannelInteractionRoute;
  auth: ResolvedChannelAuth;
  sessionTarget: AgentSessionTarget;
  sessionDiagnostics: SessionDiagnostics;
}) {
  const lines = [
    "Who am I",
    "",
    `platform: \`${params.identity.platform}\``,
    `conversationKind: \`${params.identity.conversationKind}\``,
    `agentId: \`${params.route.agentId}\``,
    `sessionKey: \`${params.sessionTarget.sessionKey}\``,
    `storedSessionId: \`${params.sessionDiagnostics.sessionId ?? "(not captured yet)"}\``,
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
    `resumeCommand: \`${params.sessionDiagnostics.resumeCommand ?? "(not available yet)"}\``,
    `principal: \`${params.auth.principal ?? "(none)"}\``,
    `principalFormat: \`${renderPrincipalFormat(params.identity)}\``,
    `principalExample: \`${renderPrincipalExample(params.identity)}\``,
    `appRole: \`${params.auth.appRole}\``,
    `agentRole: \`${params.auth.agentRole}\``,
    `mayBypassPairing: \`${params.auth.mayBypassPairing}\``,
    `mayBypassSharedSenderPolicy: \`${params.auth.mayBypassSharedSenderPolicy}\``,
    `mayManageProtectedResources: \`${params.auth.mayManageProtectedResources}\``,
    `canUseShell: \`${params.auth.canUseShell}\``,
    `verbose: \`${params.route.verbose}\``,
  );

  return lines.join("\n");
}

function renderRouteStatusMessage(params: {
  identity: ChannelInteractionIdentity;
  route: ChannelInteractionRoute;
  auth: ResolvedChannelAuth;
  sessionTarget: AgentSessionTarget;
  sessionDiagnostics: SessionDiagnostics;
  followUpState: {
    overrideMode?: "auto" | "mention-only" | "paused";
    lastBotReplyAt?: number;
  };
  runtimeState: {
    state: "idle" | "running" | "detached";
    startedAt?: number;
    detachedAt?: number;
  };
  loopState: {
    sessionLoops: ReturnType<AgentService["listIntervalLoops"]>;
    globalLoopCount: number;
  };
  timezone: {
    effective: string;
    route?: string;
    bot?: string;
  };
}) {
  const lines = [
    "Status",
    "",
    `platform: \`${params.identity.platform}\``,
    `conversationKind: \`${params.identity.conversationKind}\``,
    `agentId: \`${params.route.agentId}\``,
    `sessionKey: \`${params.sessionTarget.sessionKey}\``,
    `storedSessionId: \`${params.sessionDiagnostics.sessionId ?? "(not captured yet)"}\``,
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
    `resumeCommand: \`${params.sessionDiagnostics.resumeCommand ?? "(not available yet)"}\``,
    `principal: \`${params.auth.principal ?? "(none)"}\``,
    `principalFormat: \`${renderPrincipalFormat(params.identity)}\``,
    `principalExample: \`${renderPrincipalExample(params.identity)}\``,
    `streaming: \`${params.route.streaming}\``,
    `response: \`${params.route.response}\``,
    `responseMode: \`${params.route.responseMode}\``,
    `additionalMessageMode: \`${params.route.additionalMessageMode}\``,
    `surfaceNotifications.queueStart: \`${params.route.surfaceNotifications.queueStart}\``,
    `surfaceNotifications.loopStart: \`${params.route.surfaceNotifications.loopStart}\``,
    `verbose: \`${params.route.verbose}\``,
    `appRole: \`${params.auth.appRole}\``,
    `agentRole: \`${params.auth.agentRole}\``,
    `mayBypassSharedSenderPolicy: \`${params.auth.mayBypassSharedSenderPolicy}\``,
    `mayManageProtectedResources: \`${params.auth.mayManageProtectedResources}\``,
    `canUseShell: \`${params.auth.canUseShell}\``,
    `timezone.effective: \`${params.timezone.effective}\``,
    `timezone.route: \`${params.timezone.route ?? "(inherit)"}\``,
    `timezone.bot: \`${params.timezone.bot ?? "(inherit)"}\``,
    `followUp.mode: \`${params.followUpState.overrideMode ?? params.route.followUp.mode}\``,
    `followUp.windowMinutes: \`${formatFollowUpTtlMinutes(params.route.followUp.participationTtlMs)}\``,
    `run.state: \`${params.runtimeState.state}\``,
  );

  if (params.runtimeState.startedAt) {
    lines.push(`run.startedAt: \`${new Date(params.runtimeState.startedAt).toISOString()}\``);
  }

  if (params.runtimeState.detachedAt) {
    lines.push(`run.detachedAt: \`${new Date(params.runtimeState.detachedAt).toISOString()}\``);
  }

  lines.push(
    `activeLoops.session: \`${params.loopState.sessionLoops.length}\``,
    `activeLoops.global: \`${params.loopState.globalLoopCount}\``,
  );

  if (params.loopState.sessionLoops.length > 0) {
    lines.push("", "Session loops:");
    for (const loop of params.loopState.sessionLoops) {
      lines.push(
        `- \`${loop.id}\` ${renderManagedLoopStatusSchedule(loop)} remaining \`${loop.remainingRuns}\` nextRunAt \`${new Date(loop.nextRunAt).toISOString()}\``,
      );
    }
  }

  lines.push(
    "",
    "Useful commands:",
    "- `/help`",
    "- `/whoami`",
    "- `/status`",
    "- `/attach`, `/detach`, `/watch every <duration>`",
    "- `/followup status`, `/mention`, `/mention channel`, `/mention all`",
    "- `/streaming status|on|off|latest|all`",
    "- `/responsemode status`",
    "- `/additionalmessagemode status`",
    "- `/loop help`, `/loop status`, `/loop cancel`, `/loop cancel <id>`",
    "- `/queue help`, `/queue <message>`, `/steer <message>`",
    "- `/queue list`, `/queue clear`",
    params.route.verbose === "off"
      ? "- `/transcript` disabled on this route (`verbose: off`)"
      : "- `/transcript` enabled on this route (`verbose: minimal`)",
    "- `/bash` requires `shellExecute`",
  );

  return lines.join("\n");
}

function allowTranscriptInspectionForRoute(route: ChannelInteractionRoute) {
  return route.verbose === "minimal";
}

function renderResponseModeStatusMessage(params: {
  route: ChannelInteractionRoute;
  persisted?: {
    label: string;
    responseMode?: "capture-pane" | "message-tool";
  };
}) {
  const lines = [
    "Response mode",
    "",
    `activeRoute.responseMode: \`${params.route.responseMode}\``,
  ];

  if (params.persisted) {
    lines.push(`config.target: \`${params.persisted.label}\``);
    lines.push(`config.responseMode: \`${params.persisted.responseMode ?? "(inherit)"}\``);
  }

  lines.push(
    "",
    "Available values:",
    "- `capture-pane`: clisbot posts pane-derived progress and the final result",
    `- \`message-tool\`: clisbot still monitors the pane, but the agent should reply with ${renderCliCommand("message send", { inline: true })}`,
  );

  return lines.join("\n");
}

function renderStreamingStatusMessage(params: {
  route: ChannelInteractionRoute;
  persisted?: {
    label: string;
    streaming?: "off" | "latest" | "all";
  };
}) {
  const lines = [
    `Streaming mode: \`${params.route.streaming}\``,
  ];

  if (params.persisted) {
    lines.push("");
    lines.push(`config.target: \`${params.persisted.label}\``);
  }

  lines.push(
    "",
    "Available values:",
    "- `off`: do not show live surface preview updates",
    "- `on`: slash-command shorthand that persists as `all`",
    "- `all`: keep streaming enabled with the current full preview behavior",
    "- `latest`: keep streaming enabled; current runtime behavior still matches `all` until preview shaping is refined",
  );

  return lines.join("\n");
}

function renderAdditionalMessageModeStatusMessage(params: {
  route: ChannelInteractionRoute;
  persisted?: {
    label: string;
    additionalMessageMode?: "queue" | "steer";
  };
}) {
  const lines = [
    "Additional message mode",
    "",
    `activeRoute.additionalMessageMode: \`${params.route.additionalMessageMode}\``,
  ];

  if (params.persisted) {
    lines.push(`config.target: \`${params.persisted.label}\``);
    lines.push(
      `config.additionalMessageMode: \`${params.persisted.additionalMessageMode ?? "(inherit)"}\``,
    );
  }

  lines.push(
    "",
    "Available values:",
    "- `steer`: send later user messages straight into the already-running session",
    "- `queue`: enqueue later user messages behind the active run and settle them one by one",
    "",
    "Per-message override:",
    "- `/queue <message>` always uses queued delivery for that one message",
  );

  return lines.join("\n");
}

function renderFollowUpModeUpdateMessage(params: {
  scope: "conversation" | "channel" | "all";
  mode: "auto" | "mention-only" | "paused";
  persisted?: {
    label: string;
    configPath: string;
    followUpMode: "auto" | "mention-only" | "paused";
  };
}) {
  if (!params.persisted) {
    if (params.mode === "paused") {
      return "Follow-up paused for this conversation until the next explicit mention.";
    }

    return `Follow-up mode set to \`${params.mode}\` for this conversation.`;
  }

  const lines = [
    `Updated follow-up mode for \`${params.persisted.label}\`.`,
    `config.followUp.mode: \`${params.persisted.followUpMode}\``,
    `config: \`${params.persisted.configPath}\``,
    `currentConversation.overrideMode: \`${params.mode}\``,
    "The current conversation changes immediately.",
    "If config reload is enabled, the broader default should apply automatically shortly.",
  ];

  if (params.scope === "all") {
    lines.splice(
      4,
      0,
      "This persists the bot-wide default for later routed conversations on this bot.",
    );
  } else if (params.scope === "channel") {
    lines.splice(
      4,
      0,
      "This persists the default for the current channel, group, or DM container.",
    );
  }

  return lines.join("\n");
}

function buildChannelObserverId(identity: ChannelInteractionIdentity) {
  return [
    identity.platform,
    identity.conversationKind,
    identity.senderId ?? "",
    identity.channelId ?? "",
    identity.chatId ?? "",
    identity.threadTs ?? "",
    identity.topicId ?? "",
  ].join(":");
}

function renderQueuedMessagesList(
  items: {
    text: string;
    createdAt: number;
  }[],
) {
  if (items.length === 0) {
    return "Queue is empty.";
  }

  const lines = [
    "Queued messages",
    "",
  ];
  for (const [index, item] of items.entries()) {
    lines.push(
      `${index + 1}. ${item.text}`,
      `queuedAt: \`${new Date(item.createdAt).toISOString()}\``,
      "",
    );
  }
  return lines.join("\n").trimEnd();
}

function renderQueueUsage() {
  return [
    "Queue commands",
    "",
    ...renderQueueHelpLines(),
    "",
    "Notes:",
    "- use queue when the current run should finish first and the next user request can wait in order",
    "- use steer when the active run should be nudged or redirected immediately",
  ].join("\n");
}

function renderLoopUsage() {
  return [
    "Usage:",
    "- `/loop help`",
    "- `/loop 5m check CI`",
    "- `/loop 1m --force check CI`",
    "- `/loop 5m`",
    "- `/loop check deploy every 2h`",
    "- `/loop check deploy every 1m --force`",
    "- `/loop every day at 07:00 check CI`",
    "- `/loop every weekday at 07:00 check CI`",
    "- `/loop every mon at 09:00 check CI`",
    "- `/loop 3 check CI`",
    "- `/loop 3`",
    "- `/loop 3 /codereview`",
    "- `/loop /codereview 3 times`",
    "- `/loop status`",
    `- \`/loop cancel\`, \`/loop cancel <id>\`, \`/loop cancel --all\`, \`/loop cancel --all ${LOOP_APP_FLAG}\``,
    "- wall-clock loop timezone resolves from route/topic, agent, bot, app timezone, then legacy defaults and host timezone",
  ].join("\n");
}

function renderLoopStatusMessage(params: {
  sessionLoops: ReturnType<AgentService["listIntervalLoops"]>;
  globalLoopCount: number;
}) {
  if (params.sessionLoops.length === 0) {
    return [
      "Active loops",
      "",
      "No active loops for this session.",
      `activeLoops.global: \`${params.globalLoopCount}\``,
    ].join("\n");
  }

  const lines = [
    "Active loops",
    "",
    `activeLoops.session: \`${params.sessionLoops.length}\``,
    `activeLoops.global: \`${params.globalLoopCount}\``,
    "",
  ];

  for (const loop of params.sessionLoops) {
    lines.push(
      `- id: \`${loop.id}\` ${renderManagedLoopStatusSchedule(loop)} remaining: \`${loop.remainingRuns}\` nextRunAt: \`${new Date(loop.nextRunAt).toISOString()}\` prompt: \`${loop.promptSummary}\`${loop.kind !== "calendar" && loop.force ? " force" : ""}`,
    );
  }

  return lines.join("\n");
}

function resolveEffectiveLoopTimezone(params: {
  agentService: AgentService;
  agentId: string;
  routeTimezone?: string;
  botTimezone?: string;
}) {
  return params.agentService.resolveEffectiveTimezone({
    agentId: params.agentId,
    routeTimezone: params.routeTimezone,
    botTimezone: params.botTimezone,
  }).timezone;
}

function buildLoopSurfaceBinding(identity: ChannelInteractionIdentity) {
  return {
    platform: identity.platform,
    botId: resolveChannelIdentityBotId(identity),
    conversationKind: identity.conversationKind,
    channelId: identity.channelId,
    channelName: identity.channelName,
    chatId: identity.chatId,
    chatName: identity.chatName,
    threadTs: identity.threadTs,
    topicId: identity.topicId,
    topicName: identity.topicName,
  };
}

function buildLoopSender(identity: ChannelInteractionIdentity): StoredLoopSender | undefined {
  const providerId = identity.senderId?.trim();
  if (!providerId) {
    return undefined;
  }
  return {
    senderId: identity.platform === "slack"
      ? `slack:${providerId.toUpperCase()}`
      : `telegram:${providerId}`,
    providerId,
    displayName: identity.senderName,
    handle: identity.senderHandle,
  };
}

async function executePromptDelivery<TChunk>(params: {
  agentService: AgentService;
  sessionTarget: AgentSessionTarget;
  identity: ChannelInteractionIdentity;
  route: ChannelInteractionRoute;
  maxChars: number;
  promptText: string | (() => string);
  queueText?: string;
  postText: PostText<TChunk>;
  reconcileText: ReconcileText<TChunk>;
  observerId: string;
  timingContext?: LatencyDebugContext;
  forceQueuedDelivery?: boolean;
  queueStartMode?: SurfaceNotificationMode;
  notificationPromptSummary?: string;
  suppressDetachedSettlement?: boolean;
  onPromptAccepted?: () => Promise<void>;
}) {
  let responseChunks: TChunk[] = [];
  let renderedState: ChannelRenderedMessageState | undefined;
  let renderChain = Promise.resolve();
  let replyRecorded = false;
  let finalReplyRecorded = false;
  let loggedFirstRunningUpdate = false;
  let activePreviewStartedAt: number | undefined;
  let messageToolPreviewHandedOff = false;
  let messageToolPreviewMonitorStarted = false;
  let stopMessageToolPreviewMonitor = false;
  let messageToolPreviewMonitor: Promise<void> | undefined;
  let queueStartPending = false;
  let deferredQueueStartPreview = false;
  let queueAckPending = false;
  let queueStartDeferredForAck = false;
  const paneManagedDelivery =
    params.route.responseMode === "capture-pane" || params.forceQueuedDelivery === true;
  const messageToolPreview =
    params.route.responseMode === "message-tool" &&
    params.forceQueuedDelivery !== true &&
    params.route.streaming !== "off";
  const previewEnabled =
    params.route.streaming !== "off" && (paneManagedDelivery || messageToolPreview);

  async function recordVisibleReply(
    kind: "reply" | "final" = "reply",
    source: "channel" | "message-tool" = "channel",
  ) {
    if (kind === "final") {
      if (finalReplyRecorded) {
        return;
      }

      await params.agentService.recordConversationReply(params.sessionTarget, "final", source);
      finalReplyRecorded = true;
      replyRecorded = true;
      return;
    }

    if (replyRecorded) {
      return;
    }

    await params.agentService.recordConversationReply(params.sessionTarget, "reply", source);
    replyRecorded = true;
  }

  async function renderResponseText(nextText: string) {
    if (!responseChunks.length) {
      responseChunks = await params.postText(nextText);
      return responseChunks.length > 0;
    }

    responseChunks = await params.reconcileText(responseChunks, nextText);
    return false;
  }

  async function clearResponseText() {
    if (!responseChunks.length) {
      return;
    }

    responseChunks = await params.reconcileText(responseChunks, "");
    renderedState = undefined;
    activePreviewStartedAt = undefined;
  }

  async function handoffMessageToolPreview() {
    if (messageToolPreviewHandedOff) {
      return;
    }

    messageToolPreviewHandedOff = true;
    await clearResponseText();
  }

  function hasMessageToolReplyBoundary(params: {
    lastMessageToolReplyAt?: number;
    messageToolFinalReplyAt?: number;
  }) {
    if (typeof activePreviewStartedAt !== "number") {
      return false;
    }

    return (
      (typeof params.messageToolFinalReplyAt === "number" &&
        params.messageToolFinalReplyAt >= activePreviewStartedAt) ||
      (typeof params.lastMessageToolReplyAt === "number" &&
        params.lastMessageToolReplyAt >= activePreviewStartedAt)
    );
  }

  function hasMessageToolFinalReplyBoundary(params: {
    messageToolFinalReplyAt?: number;
  }) {
    return (
      typeof activePreviewStartedAt === "number" &&
      typeof params.messageToolFinalReplyAt === "number" &&
      params.messageToolFinalReplyAt >= activePreviewStartedAt
    );
  }

  async function getMessageToolRuntimeSignals() {
    if (params.route.responseMode !== "message-tool" || params.forceQueuedDelivery === true) {
      return {
        lastMessageToolReplyAt: undefined,
        messageToolFinalReplyAt: undefined,
      };
    }

    const runtime = await params.agentService.getSessionRuntime?.(params.sessionTarget);
    return {
      lastMessageToolReplyAt: runtime?.lastMessageToolReplyAt,
      messageToolFinalReplyAt: runtime?.messageToolFinalReplyAt,
    };
  }

  function ensureMessageToolPreviewMonitor() {
    if (
      !messageToolPreview ||
      messageToolPreviewMonitorStarted ||
      typeof activePreviewStartedAt !== "number"
    ) {
      return;
    }

    messageToolPreviewMonitorStarted = true;
    messageToolPreviewMonitor = (async () => {
      while (!stopMessageToolPreviewMonitor && !messageToolPreviewHandedOff) {
        const signals = await getMessageToolRuntimeSignals();
        if (hasMessageToolReplyBoundary(signals)) {
          await (renderChain = renderChain.then(async () => {
            const latestSignals = await getMessageToolRuntimeSignals();
            if (hasMessageToolReplyBoundary(latestSignals)) {
              await handoffMessageToolPreview();
            }
          }));
          return;
        }

        await sleep(MESSAGE_TOOL_PREVIEW_SIGNAL_POLL_MS);
      }
    })().catch((error) => {
      console.error("message-tool preview monitor failed", error);
    });
  }

  async function waitForMessageToolFinalReply(params: {
    deadlineAt?: number;
    stopWhen?: () => boolean;
  } = {}) {
    const deadline = params.deadlineAt ?? (Date.now() + MESSAGE_TOOL_FINAL_GRACE_WINDOW_MS);

    while (true) {
      if (params.stopWhen?.()) {
        return false;
      }

      const signals = await getMessageToolRuntimeSignals();
      const toolFinalSeen =
        typeof signals.messageToolFinalReplyAt === "number" &&
        Number.isFinite(signals.messageToolFinalReplyAt);
      if (toolFinalSeen) {
        return true;
      }

      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        return false;
      }

      await sleep(Math.min(MESSAGE_TOOL_FINAL_GRACE_POLL_MS, remainingMs));
    }
  }

  logLatencyDebug("channel-enqueue-start", params.timingContext, {
    agentId: params.route.agentId,
    sessionKey: params.sessionTarget.sessionKey,
  });

  function assertRunUpdateBelongsToSession(update: { sessionKey: string }) {
    if (update.sessionKey !== params.sessionTarget.sessionKey) {
      throw new Error(
        `Refusing to render runner output for sessionKey ${update.sessionKey} into ${params.sessionTarget.sessionKey}.`,
      );
    }
  }

  async function maybeRenderQueueStartNotification() {
    if (!queueStartPending) {
      return false;
    }

    const text = renderQueueStartNotification({
      mode: params.queueStartMode ?? "none",
      agentId: params.route.agentId,
      promptSummary:
        params.notificationPromptSummary ??
        summarizeSurfaceNotificationText(params.queueText ?? String(params.promptText)),
    });
    if (!text) {
      queueStartPending = false;
      return false;
    }

    if (previewEnabled && responseChunks.length === 0) {
      deferredQueueStartPreview = true;
      return true;
    }

    if (queueAckPending && responseChunks.length === 0) {
      queueStartDeferredForAck = true;
      return true;
    }

    queueStartPending = false;
    if (responseChunks.length > 0) {
      const postedNew = await renderResponseText(text);
      if (postedNew) {
        await recordVisibleReply("reply", "channel");
        activePreviewStartedAt = Date.now();
      }
      renderedState = {
        text,
        body: "",
      };
      return true;
    }

    const postedNew = await renderResponseText(text);
    if (postedNew) {
      await recordVisibleReply("reply", "channel");
      activePreviewStartedAt = Date.now();
    }
    renderedState = {
      text,
      body: "",
    };
    return postedNew;
  }

  function buildInitialPlaceholderText(positionAhead: number) {
    if (
      queueStartPending &&
      params.forceQueuedDelivery === true &&
      positionAhead === 0
    ) {
      queueStartPending = false;
      return (
        renderQueueStartNotification({
          mode: params.queueStartMode ?? "none",
          agentId: params.route.agentId,
          promptSummary:
            params.notificationPromptSummary ??
            summarizeSurfaceNotificationText(params.queueText ?? String(params.promptText)),
        }) ??
        renderPlatformInteraction({
          platform: params.identity.platform,
          status: "running",
          content: "",
          queuePosition: positionAhead,
          maxChars: Number.POSITIVE_INFINITY,
          note: "Working...",
        })
      );
    }

    if (deferredQueueStartPreview && queueStartPending) {
      deferredQueueStartPreview = false;
      queueStartPending = false;
      return (
        renderQueueStartNotification({
          mode: params.queueStartMode ?? "none",
          agentId: params.route.agentId,
          promptSummary:
            params.notificationPromptSummary ??
            summarizeSurfaceNotificationText(params.queueText ?? String(params.promptText)),
        }) ??
        renderPlatformInteraction({
          platform: params.identity.platform,
          status: positionAhead > 0 ? "queued" : "running",
          content: "",
          queuePosition: positionAhead,
          maxChars: Number.POSITIVE_INFINITY,
          note:
            positionAhead > 0 ? "Waiting for the agent queue to clear." : "Working...",
        })
      );
    }

    return renderPlatformInteraction({
      platform: params.identity.platform,
      status: positionAhead > 0 ? "queued" : "running",
      content: "",
      queuePosition: positionAhead,
      maxChars: Number.POSITIVE_INFINITY,
      note: positionAhead > 0 ? "Waiting for the agent queue to clear." : "Working...",
    });
  }

  try {
    const { positionAhead, result } = params.agentService.enqueuePrompt(
      params.sessionTarget,
      params.promptText,
      {
        observerId: params.observerId,
        timingContext: params.timingContext,
        queueText: params.queueText,
        onUpdate: async (update) => {
          assertRunUpdateBelongsToSession(update);
          if (update.status === "running" && !loggedFirstRunningUpdate) {
            loggedFirstRunningUpdate = true;
            logLatencyDebug("channel-first-running-update", params.timingContext, {
              sessionName: update.sessionName,
              sessionKey: update.sessionKey,
            });
          }

          await (renderChain = renderChain.then(async () => {
            const initialSignals = await getMessageToolRuntimeSignals();
            if (messageToolPreview && hasMessageToolFinalReplyBoundary(initialSignals)) {
              await handoffMessageToolPreview();
              return;
            }
            if (
              messageToolPreview &&
              hasMessageToolReplyBoundary(initialSignals) &&
              !update.forceVisible
            ) {
              await handoffMessageToolPreview();
              return;
            }
            if (messageToolPreviewHandedOff && !paneManagedDelivery && !update.forceVisible) {
              return;
            }
            let renderedQueueStart = false;
            if (update.status === "running") {
              renderedQueueStart = await maybeRenderQueueStartNotification();
            }
            if (!update.forceVisible && !paneManagedDelivery && !messageToolPreview) {
              return;
            }
            if (
              params.route.streaming === "off" &&
              update.status === "running" &&
              !update.forceVisible
            ) {
              return;
            }
            if (renderedQueueStart) {
              return;
            }
            const nextState = buildRenderedMessageState({
              platform: params.identity.platform,
              status: update.status,
              snapshot: update.snapshot,
              queuePosition: positionAhead,
              maxChars: Number.POSITIVE_INFINITY,
              note: update.note,
              allowTranscriptInspection: allowTranscriptInspectionForRoute(params.route),
              previousState: renderedState,
              responsePolicy: params.route.response,
            });
            if (renderedState?.text === nextState.text) {
              return;
            }

            const postedNew = await renderResponseText(nextState.text);
            if (postedNew) {
              await recordVisibleReply("reply", "channel");
              activePreviewStartedAt = Date.now();
              ensureMessageToolPreviewMonitor();
            }
            renderedState = nextState;
          }));
        },
      },
    );
    queueStartPending =
      (positionAhead > 0 || params.forceQueuedDelivery === true) &&
      (params.queueStartMode ?? "none") !== "none";
    if (params.onPromptAccepted) {
      await params.onPromptAccepted();
    }

    if (previewEnabled) {
      const placeholderText = buildInitialPlaceholderText(positionAhead);
      const postedNew = await renderResponseText(placeholderText);
      if (postedNew) {
        await recordVisibleReply("reply", "channel");
        activePreviewStartedAt = Date.now();
        ensureMessageToolPreviewMonitor();
      }
      renderedState = {
        text: placeholderText,
        body: "",
      };
    } else if (
      paneManagedDelivery &&
      positionAhead === 0 &&
      params.forceQueuedDelivery === true
    ) {
      await maybeRenderQueueStartNotification();
    } else if (
      paneManagedDelivery &&
      positionAhead > 0 &&
      (params.route.streaming !== "off" || params.forceQueuedDelivery === true)
    ) {
      const queuedText = renderPlatformInteraction({
        platform: params.identity.platform,
        status: "queued",
        content: "",
        queuePosition: positionAhead,
        maxChars: Number.POSITIVE_INFINITY,
        note: "Waiting for the agent queue to clear.",
      });
      queueAckPending = true;
      let postedNew = false;
      try {
        postedNew = await renderResponseText(queuedText);
      } finally {
        queueAckPending = false;
      }
      if (postedNew) {
        await recordVisibleReply("reply", "channel");
      }
      renderedState = {
        text: queuedText,
        body: "",
      };
      if (queueStartDeferredForAck) {
        queueStartDeferredForAck = false;
        await maybeRenderQueueStartNotification();
      }
    }

    const returnOnToolFinal =
      params.route.responseMode === "message-tool" &&
      params.forceQueuedDelivery !== true;
    let stopEarlyToolFinalWait = false;
    const earlyToolFinalOutcome = returnOnToolFinal
      ? await Promise.race([
        result.then(
          () => "result" as const,
          () => "result" as const,
        ),
        waitForMessageToolFinalReply({
          deadlineAt: Number.POSITIVE_INFINITY,
          stopWhen: () => stopEarlyToolFinalWait,
        }).then((seen) => (seen ? "tool-final" as const : "result" as const)),
      ])
      : "result";
    stopEarlyToolFinalWait = true;

    if (earlyToolFinalOutcome === "tool-final") {
      await renderChain;
      if (messageToolPreview && responseChunks.length > 0) {
        await handoffMessageToolPreview();
      } else if (params.route.response === "final") {
        await clearResponseText();
      }
      void result.catch((error) => {
        console.error(
          "message-tool run settled after the channel already observed a final reply",
          error,
        );
      });
      return;
    }

    const finalResult = await result;
    assertRunUpdateBelongsToSession(finalResult);
    await renderChain;

    if (params.suppressDetachedSettlement && finalResult.status === "detached") {
      return;
    }

    if (!paneManagedDelivery && messageToolPreviewHandedOff) {
      return;
    }

    const nextState = buildRenderedMessageState({
      platform: params.identity.platform,
      status: finalResult.status,
      snapshot: finalResult.snapshot,
      maxChars: Number.POSITIVE_INFINITY,
      note: finalResult.note,
      allowTranscriptInspection: allowTranscriptInspectionForRoute(params.route),
      previousState: renderedState,
      responsePolicy: params.route.response,
    });

    if (paneManagedDelivery) {
      if (params.route.streaming === "off") {
        const postedNew = await renderResponseText(
          renderPlatformInteraction({
            platform: params.identity.platform,
            status: finalResult.status,
            content: nextState.body,
            maxChars: Number.POSITIVE_INFINITY,
            note: finalResult.note,
            allowTranscriptInspection: allowTranscriptInspectionForRoute(params.route),
            responsePolicy: params.route.response,
          }),
        );
        if (postedNew || finalResult.status === "completed") {
          await recordVisibleReply(
            finalResult.status === "completed" ? "final" : "reply",
            "channel",
          );
        }
        return;
      }

      const postedNew = await renderResponseText(nextState.text);
      if (postedNew) {
        await recordVisibleReply("reply", "channel");
      }
      if (finalResult.status === "completed") {
        await recordVisibleReply("final", "channel");
      }
      return;
    }

    const toolFinalSeen =
      finalResult.status === "completed"
        ? await waitForMessageToolFinalReply()
        : false;

    if (finalResult.status === "completed" && toolFinalSeen) {
      if (params.route.response === "final") {
        await clearResponseText();
      }
      return;
    }

    if (finalResult.status === "completed") {
      // Deliberately do not fall back to pane-derived final settlement in message-tool mode.
      // The tool path is the only source of truth for canonical replies here, and re-enabling
      // pane fallback tends to reintroduce duplicate or out-of-order terminal messages because
      // tool-final state is asynchronous and subtle to coordinate across channel/runtime boundaries.
      return;
    }

    if (
      params.route.responseMode === "message-tool" &&
      params.forceQueuedDelivery !== true &&
      params.route.streaming === "off" &&
      responseChunks.length === 0 &&
      finalResult.status !== "error"
    ) {
      return;
    }

    if (messageToolPreview && responseChunks.length > 0) {
      const postedNew = await renderResponseText(
        renderPlatformInteraction({
          platform: params.identity.platform,
          status: finalResult.status,
          content: "",
          maxChars: Number.POSITIVE_INFINITY,
          note: finalResult.note,
          allowTranscriptInspection: allowTranscriptInspectionForRoute(params.route),
          responsePolicy: params.route.response,
        }),
      );
      if (postedNew) {
        await recordVisibleReply("reply", "channel");
      }
      return;
    }

    if (params.route.streaming === "off" || responseChunks.length === 0) {
      const postedNew = await renderResponseText(
        renderPlatformInteraction({
          platform: params.identity.platform,
          status: finalResult.status,
          content: nextState.body,
          maxChars: Number.POSITIVE_INFINITY,
          note: finalResult.note,
          allowTranscriptInspection: allowTranscriptInspectionForRoute(params.route),
          responsePolicy: params.route.response,
        }),
      );
      if (postedNew) {
        await recordVisibleReply("reply", "channel");
      }
      return;
    }

    const postedNew = await renderResponseText(nextState.text);
    if (postedNew) {
      await recordVisibleReply("reply", "channel");
    }
  } catch (error) {
    if (error instanceof ClearedQueuedTaskError) {
      return;
    }
    if (error instanceof ActiveRunInProgressError) {
      const activeText =
        error.update.status === "detached"
          ? resolveDetachedInteractionNote({
              baseNote: error.update.note ?? String(error),
              allowTranscriptInspection: allowTranscriptInspectionForRoute(params.route),
              transcriptCommand:
                params.identity.platform === "telegram" ? "/transcript" : "`/transcript`",
            })
          : (error.update.note ?? String(error));
      if (params.route.streaming !== "off" && responseChunks.length > 0) {
        await params.reconcileText(responseChunks, activeText);
      } else {
        await params.postText(activeText);
      }
      await recordVisibleReply("reply", "channel");
      return;
    }

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
    await recordVisibleReply("reply", "channel");
  } finally {
    stopMessageToolPreviewMonitor = true;
    if (messageToolPreviewMonitor) {
      await messageToolPreviewMonitor;
    }
  }
}

export async function processChannelInteraction<TChunk>(params: {
  agentService: AgentService;
  sessionTarget: AgentSessionTarget;
  identity: ChannelInteractionIdentity;
  auth?: ResolvedChannelAuth;
  senderId?: string;
  text: string;
  agentPromptText?: string;
  agentPromptBuilder?: (text: string) => string;
  promptContext?: SurfacePromptContext;
  protectedControlMutationRule?: string;
  route: ChannelInteractionRoute;
  maxChars: number;
  postText: PostText<TChunk>;
  reconcileText: ReconcileText<TChunk>;
  timingContext?: LatencyDebugContext;
  transformSessionInputText?: (text: string) => string;
  onPromptAccepted?: () => Promise<void>;
}): Promise<ProcessChannelInteractionResult> {
  const interactionResult: ProcessChannelInteractionResult = {
    processingIndicatorLifecycle: "handler",
  };
  let responseChunks: TChunk[] = [];
  let renderedState: ChannelRenderedMessageState | undefined;
  const observerId = buildChannelObserverId(params.identity);
  const auth = params.auth ?? {
    principal: params.senderId ? `${params.identity.platform}:${params.senderId}` : undefined,
    appRole: "member",
    agentRole: "member",
    mayBypassPairing: false,
    mayBypassSharedSenderPolicy: false,
    mayManageProtectedResources: false,
    canUseShell: false,
  };
  let replyRecorded = false;
  let renderChain = Promise.resolve();
  const sessionDiagnostics =
    await params.agentService.getSessionDiagnostics?.(params.sessionTarget) ?? {};

  async function recordReplyIfNeeded() {
    if (replyRecorded) {
      return;
    }

    await params.agentService.recordConversationReply(params.sessionTarget);
    replyRecorded = true;
  }

  async function renderResponseText(nextText: string) {
    if (!responseChunks.length) {
      responseChunks = await params.postText(nextText);
      if (responseChunks.length > 0) {
        await recordReplyIfNeeded();
      }
      return;
    }

    responseChunks = await params.reconcileText(responseChunks, nextText);
  }

  async function applyRunUpdate(update: RunUpdate) {
    await (renderChain = renderChain.then(async () => {
      const nextState = buildRenderedMessageState({
        platform: params.identity.platform,
        status: update.status,
        snapshot: update.snapshot,
        maxChars: Number.POSITIVE_INFINITY,
        note: update.note,
        previousState: renderedState,
        responsePolicy: params.route.response,
      });
      if (renderedState?.text === nextState.text) {
        return;
      }

      await renderResponseText(nextState.text);
      renderedState = nextState;
    }));
  }

  function buildRunObserver(paramsForObserver: {
    mode: RunObserverMode;
    intervalMs?: number;
    durationMs?: number;
  }) {
    return {
      id: observerId,
      mode: paramsForObserver.mode,
      intervalMs: paramsForObserver.intervalMs,
      expiresAt: paramsForObserver.durationMs
        ? Date.now() + paramsForObserver.durationMs
        : undefined,
      onUpdate: async (update: RunUpdate) => {
        await applyRunUpdate(update);
      },
    };
  }

  const slashCommand = parseAgentCommand(params.text, {
    commandPrefixes: params.route.commandPrefixes,
  });
  const explicitQueueMessage =
    slashCommand?.type === "queue" ? slashCommand.text.trim() : undefined;
  const explicitSteerMessage =
    slashCommand?.type === "steer" ? slashCommand.text.trim() : undefined;
  const sessionBusy = await (
    params.agentService.isAwaitingFollowUpRouting?.(params.sessionTarget) ??
    params.agentService.isSessionBusy?.(params.sessionTarget) ??
    false
  );
  const canSteerActiveRun =
    params.agentService.canSteerActiveRun?.(params.sessionTarget) ??
    !sessionBusy;
  const queueByMode = !explicitQueueMessage && params.route.additionalMessageMode === "queue" && sessionBusy;
  const forceQueuedDelivery = typeof explicitQueueMessage === "string" || queueByMode;
  const delayedPromptQueueText = explicitQueueMessage ?? params.text;
  const delayedPromptText = () => {
    if (forceQueuedDelivery && params.agentPromptBuilder) {
      return params.agentPromptBuilder(delayedPromptQueueText);
    }
    if (explicitQueueMessage) {
      return explicitQueueMessage;
    }
    return params.agentPromptText ?? params.text;
  };
  const isSensitiveCommand = slashCommand?.type === "bash";

  if (isSensitiveCommand && !auth.canUseShell) {
    await params.postText(renderSensitiveCommandDisabledMessage());
    await params.agentService.recordConversationReply(params.sessionTarget);
    return interactionResult;
  }

  if (slashCommand?.type === "control") {
    if (slashCommand.name === "start" || slashCommand.name === "status") {
      const followUpState =
        await params.agentService.getConversationFollowUpState(params.sessionTarget);
      const runtimeState = await params.agentService.getSessionRuntime(params.sessionTarget);
      const sessionLoops = params.agentService.listIntervalLoops?.({
        sessionKey: params.sessionTarget.sessionKey,
      }) ?? [];
      await params.postText(
        renderRouteStatusMessage({
          identity: params.identity,
          route: params.route,
          auth,
          sessionTarget: params.sessionTarget,
          sessionDiagnostics,
          followUpState,
          runtimeState,
          loopState: {
            sessionLoops,
            globalLoopCount: params.agentService.getActiveIntervalLoopCount?.() ?? 0,
          },
          timezone: {
            effective: resolveEffectiveLoopTimezone({
              agentService: params.agentService,
              agentId: params.sessionTarget.agentId,
              routeTimezone: params.route.timezone,
              botTimezone: params.route.botTimezone,
            }),
            route: params.route.timezone,
            bot: params.route.botTimezone,
          },
        }),
      );
      await params.agentService.recordConversationReply(params.sessionTarget);
      return interactionResult;
    }

    if (slashCommand.name === "help") {
      await params.postText(renderAgentControlSlashHelp());
      await params.agentService.recordConversationReply(params.sessionTarget);
      return interactionResult;
    }

    if (slashCommand.name === "whoami") {
      await params.postText(
        renderWhoAmIMessage({
          identity: params.identity,
          route: params.route,
          auth,
          sessionTarget: params.sessionTarget,
          sessionDiagnostics,
        }),
      );
      await params.agentService.recordConversationReply(params.sessionTarget);
      return interactionResult;
    }

    if (slashCommand.name === "transcript") {
      if (params.route.verbose === "off") {
        await params.postText(renderTranscriptDisabledMessage());
        await params.agentService.recordConversationReply(params.sessionTarget);
        return interactionResult;
      }

      const transcript = await params.agentService.captureTranscript(params.sessionTarget);
      await params.postText(
        slashCommand.mode === "full"
          ? renderChannelSnapshot({
              agentId: transcript.agentId,
              sessionName: transcript.sessionName,
              workspacePath: transcript.workspacePath,
              status: "completed",
              snapshot: transcript.snapshot || "(no tmux output yet)",
              maxChars: params.maxChars,
              note: "transcript command (full)",
            })
          : renderCompactChannelTranscript({
              snapshot: transcript.snapshot || "(no tmux output yet)",
              maxChars: Math.min(params.maxChars, TRANSCRIPT_PREVIEW_MAX_CHARS),
              fullCommand: "/transcript full",
            }),
      );
      return interactionResult;
    }

    if (slashCommand.name === "attach") {
      const observation = await params.agentService.observeActiveRun(
        params.sessionTarget,
        buildRunObserver({
          mode: "live",
        }),
        {
          resumeLive: true,
        },
      );
      if (!observation.active || !observation.update) {
        await params.postText("This thread does not have an active run to attach to.");
        await params.agentService.recordConversationReply(params.sessionTarget);
        return interactionResult;
      }
      await applyRunUpdate(observation.update);
      return interactionResult;
    }

    if (slashCommand.name === "detach") {
      const detached = await params.agentService.detachRunObserver(
        params.sessionTarget,
        observerId,
      );
      await params.postText(
        detached.detached
          ? "Detached this thread from live updates. clisbot will still post the final result here when the run completes."
          : "This thread is not currently attached to an active run.",
      );
      await params.agentService.recordConversationReply(params.sessionTarget);
      return interactionResult;
    }

    if (slashCommand.name === "watch") {
      const observation = await params.agentService.observeActiveRun(
        params.sessionTarget,
        buildRunObserver({
          mode: "poll",
          intervalMs: slashCommand.intervalMs,
          durationMs: slashCommand.durationMs,
        }),
      );
      if (!observation.active || !observation.update) {
        await params.postText("This thread does not have an active run to watch.");
        await params.agentService.recordConversationReply(params.sessionTarget);
        return interactionResult;
      }
      await applyRunUpdate(observation.update);
      return interactionResult;
    }

    if (slashCommand.name === "stop") {
      const stopped = await params.agentService.interruptSession(params.sessionTarget);
      await params.postText(
        stopped.interrupted
          ? `Interrupted agent \`${stopped.agentId}\` session \`${stopped.sessionName}\`.`
          : `Agent \`${stopped.agentId}\` session \`${stopped.sessionName}\` was not running.`,
      );
      await params.agentService.recordConversationReply(params.sessionTarget);
      return interactionResult;
    }

    if (slashCommand.name === "nudge") {
      const nudged = await params.agentService.nudgeSession(params.sessionTarget);
      await params.postText(
        nudged.nudged
          ? `Sent one extra Enter to agent \`${nudged.agentId}\` session \`${nudged.sessionName}\`.`
          : `No active or resumable session to nudge for agent \`${nudged.agentId}\`.`,
      );
      await params.agentService.recordConversationReply(params.sessionTarget);
      return interactionResult;
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
        if (slashCommand.scope === "channel" || slashCommand.scope === "all") {
          await params.agentService.setConversationFollowUpMode(
            params.sessionTarget,
            slashCommand.mode,
          );
          const persisted = await setScopedConversationFollowUpMode({
            identity: params.identity,
            scope: slashCommand.scope,
            mode: slashCommand.mode,
          });
          await params.postText(
            renderFollowUpModeUpdateMessage({
              scope: slashCommand.scope,
              mode: slashCommand.mode,
              persisted,
            }),
          );
        } else {
          await params.agentService.setConversationFollowUpMode(
            params.sessionTarget,
            slashCommand.mode,
          );
          await params.postText(
            renderFollowUpModeUpdateMessage({
              scope: "conversation",
              mode: slashCommand.mode,
            }),
          );
        }
      }
      await params.agentService.recordConversationReply(params.sessionTarget);
      return interactionResult;
    }

    if (slashCommand.name === "streaming") {
      if (slashCommand.action === "status") {
        const persisted = await getConversationStreaming({
          identity: params.identity,
        });
        await params.postText(
          renderStreamingStatusMessage({
            route: params.route,
            persisted,
          }),
        );
      } else if (slashCommand.streaming) {
        const persisted = await setConversationStreaming({
          identity: params.identity,
          streaming: slashCommand.streaming,
        });
        await params.postText(
          [
            `Updated streaming mode for \`${persisted.label}\`.`,
            `config.streaming: \`${persisted.streaming}\``,
            `config: \`${persisted.configPath}\``,
            slashCommand.action === "on"
              ? "`/streaming on` persists as `all` until `latest` and `all` diverge in runtime behavior."
              : "If config reload is enabled, the new mode should apply automatically shortly.",
          ].join("\n"),
        );
      }
      await params.agentService.recordConversationReply(params.sessionTarget);
      return interactionResult;
    }

    if (slashCommand.name === "responsemode") {
      if (slashCommand.action === "status") {
        const persisted = await getConversationResponseMode({
          identity: params.identity,
        });
        await params.postText(
          renderResponseModeStatusMessage({
            route: params.route,
            persisted,
          }),
        );
      } else if (slashCommand.responseMode) {
        const persisted = await setConversationResponseMode({
          identity: params.identity,
          responseMode: slashCommand.responseMode,
        });
        await params.postText(
          [
            `Updated response mode for \`${persisted.label}\`.`,
            `config.responseMode: \`${persisted.responseMode}\``,
            `config: \`${persisted.configPath}\``,
            "If config reload is enabled, the new mode should apply automatically shortly.",
          ].join("\n"),
        );
      }
      await params.agentService.recordConversationReply(params.sessionTarget);
      return interactionResult;
    }

    if (slashCommand.name === "additionalmessagemode") {
      if (slashCommand.action === "status") {
        const persisted = await getConversationAdditionalMessageMode({
          identity: params.identity,
        });
        await params.postText(
          renderAdditionalMessageModeStatusMessage({
            route: params.route,
            persisted,
          }),
        );
      } else if (slashCommand.additionalMessageMode) {
        const persisted = await setConversationAdditionalMessageMode({
          identity: params.identity,
          additionalMessageMode: slashCommand.additionalMessageMode,
        });
        await params.postText(
          [
            `Updated additional message mode for \`${persisted.label}\`.`,
            `config.additionalMessageMode: \`${persisted.additionalMessageMode}\``,
            `config: \`${persisted.configPath}\``,
            "If config reload is enabled, the new mode should apply automatically shortly.",
          ].join("\n"),
        );
      }
      await params.agentService.recordConversationReply(params.sessionTarget);
      return interactionResult;
    }

    if (slashCommand.name === "queue-list") {
      const queuedItems = params.agentService.listQueuedPrompts?.(params.sessionTarget) ?? [];
      await params.postText(renderQueuedMessagesList(queuedItems));
      await params.agentService.recordConversationReply(params.sessionTarget);
      return interactionResult;
    }

    if (slashCommand.name === "queue-help") {
      await params.postText(renderQueueUsage());
      await params.agentService.recordConversationReply(params.sessionTarget);
      return interactionResult;
    }

    if (slashCommand.name === "queue-clear") {
      const clearedCount = params.agentService.clearQueuedPrompts?.(params.sessionTarget) ?? 0;
      await params.postText(
        clearedCount > 0
          ? `Cleared ${clearedCount} queued message${clearedCount === 1 ? "" : "s"}.`
          : "Queue was already empty.",
      );
      await params.agentService.recordConversationReply(params.sessionTarget);
      return interactionResult;
    }
  }

  if (slashCommand?.type === "control" && slashCommand.name === "loop-help") {
    await params.postText(renderLoopUsage());
    await params.agentService.recordConversationReply(params.sessionTarget);
    return interactionResult;
  }

  if (slashCommand?.type === "loop-control") {
    if (slashCommand.action === "status") {
      await params.postText(
        renderLoopStatusMessage({
          sessionLoops: params.agentService.listIntervalLoops?.({
            sessionKey: params.sessionTarget.sessionKey,
          }) ?? [],
          globalLoopCount: params.agentService.getActiveIntervalLoopCount?.() ?? 0,
        }),
      );
      await params.agentService.recordConversationReply(params.sessionTarget);
      return interactionResult;
    }

    const sessionLoops = params.agentService.listIntervalLoops?.({
      sessionKey: params.sessionTarget.sessionKey,
    }) ?? [];

    if (slashCommand.all && slashCommand.app) {
      const cancelled = await params.agentService.cancelAllIntervalLoops();
      await params.postText(
        cancelled > 0
          ? `Cancelled ${cancelled} active loop${cancelled === 1 ? "" : "s"} across the whole app.`
          : "No active loops to cancel across the whole app.",
      );
      await params.agentService.recordConversationReply(params.sessionTarget);
      return interactionResult;
    }

    if (slashCommand.all) {
      const cancelled = await params.agentService.cancelIntervalLoopsForSession(params.sessionTarget);
      await params.postText(
        cancelled > 0
          ? `Cancelled ${cancelled} active loop${cancelled === 1 ? "" : "s"} for this session.`
          : "No active loops to cancel for this session.",
      );
      await params.agentService.recordConversationReply(params.sessionTarget);
      return interactionResult;
    }

    const targetLoopId =
      slashCommand.loopId ||
      (sessionLoops.length === 1 ? sessionLoops[0]?.id : undefined);
    if (!targetLoopId) {
      await params.postText(
        sessionLoops.length === 0
          ? "No active loops to cancel for this session."
          : "Multiple active loops exist for this session. Use `/loop cancel <id>` or `/loop cancel --all`.",
      );
      await params.agentService.recordConversationReply(params.sessionTarget);
      return interactionResult;
    }

    const cancelled = await params.agentService.cancelIntervalLoop(targetLoopId);
    await params.postText(
      cancelled
        ? `Cancelled loop \`${targetLoopId}\`.`
        : `No active loop found with id \`${targetLoopId}\`.`,
    );
    await params.agentService.recordConversationReply(params.sessionTarget);
    return interactionResult;
  }

  if (slashCommand?.type === "loop-error") {
    await params.postText(`${slashCommand.message}\n\n${renderLoopUsage()}`);
    await params.agentService.recordConversationReply(params.sessionTarget);
    return interactionResult;
  }

  if (slashCommand?.type === "loop") {
    const loopConfig = params.agentService.getLoopConfig();
    const maxRunsPerLoop = loopConfig.maxRunsPerLoop;
    const effectiveIntervalMs =
      slashCommand.params.mode === "interval" ? slashCommand.params.intervalMs : undefined;

    if (
      slashCommand.params.mode === "times" &&
      slashCommand.params.count > maxRunsPerLoop
    ) {
      await params.postText(
        `Loop count exceeds the configured max of \`${maxRunsPerLoop}\`.\n\n${renderLoopUsage()}`,
      );
      await params.agentService.recordConversationReply(params.sessionTarget);
      return interactionResult;
    }

    if (slashCommand.params.mode === "interval") {
      const intervalValidation = validateManagedLoopInterval({
        intervalMs: effectiveIntervalMs!,
        force: slashCommand.params.force,
      });
      if (intervalValidation.error) {
        await params.postText(`${intervalValidation.error}\n\n${renderLoopUsage()}`);
        await params.agentService.recordConversationReply(params.sessionTarget);
        return interactionResult;
      }
    }

    let resolvedLoopPrompt: Awaited<ReturnType<typeof resolveManagedLoopPromptText>>;
    try {
      const loopWorkspacePath = slashCommand.params.promptText
        ? ""
        : params.agentService.getWorkspacePath(params.sessionTarget);
      resolvedLoopPrompt = await resolveManagedLoopPromptText({
        workspacePath: loopWorkspacePath,
        promptText: slashCommand.params.promptText,
      });
    } catch (error) {
      await params.postText(String(error));
      await params.agentService.recordConversationReply(params.sessionTarget);
      return interactionResult;
    }
    const buildLoopPromptText = (text: string) =>
      params.agentPromptBuilder ? params.agentPromptBuilder(text) : text;

    if (slashCommand.params.mode === "times") {
      await params.postText(
        renderManagedLoopStartedMessage({
          mode: slashCommand.params.mode,
          count: slashCommand.params.count,
          maintenancePrompt: resolvedLoopPrompt.maintenancePrompt,
        }),
      );
      await params.agentService.recordConversationReply(params.sessionTarget);
      for (let index = 0; index < slashCommand.params.count; index += 1) {
        void executePromptDelivery({
          agentService: params.agentService,
          sessionTarget: params.sessionTarget,
          identity: params.identity,
          route: params.route,
          maxChars: params.maxChars,
          promptText: () => buildLoopPromptText(resolvedLoopPrompt.text),
          queueText: resolvedLoopPrompt.text,
          queueStartMode: params.route.surfaceNotifications.queueStart,
          notificationPromptSummary: summarizeManagedLoopPrompt(
            resolvedLoopPrompt.text,
            resolvedLoopPrompt.maintenancePrompt,
          ),
          suppressDetachedSettlement: true,
          postText: params.postText,
          reconcileText: params.reconcileText,
          observerId: `${observerId}:loop:${index + 1}`,
        });
      }
      return interactionResult;
    }

    if (slashCommand.params.mode === "calendar") {
      const effectiveTimezone = resolveEffectiveLoopTimezone({
        agentService: params.agentService,
        agentId: params.sessionTarget.agentId,
        routeTimezone: params.route.timezone,
        botTimezone: params.route.botTimezone,
      });
      const createdLoop = await params.agentService.createCalendarLoop({
        target: params.sessionTarget,
        promptText: resolvedLoopPrompt.text,
        canonicalPromptText: resolvedLoopPrompt.text,
        promptSummary: summarizeManagedLoopPrompt(
          resolvedLoopPrompt.text,
          resolvedLoopPrompt.maintenancePrompt,
        ),
        promptSource: resolvedLoopPrompt.maintenancePrompt ? "LOOP.md" : "custom",
        surfaceBinding: buildLoopSurfaceBinding(params.identity),
        cadence: slashCommand.params.cadence,
        dayOfWeek: slashCommand.params.dayOfWeek,
        localTime: slashCommand.params.localTime,
        hour: slashCommand.params.hour,
        minute: slashCommand.params.minute,
        timezone: effectiveTimezone,
        maxRuns: maxRunsPerLoop,
        createdBy: params.senderId,
        sender: buildLoopSender(params.identity),
        protectedControlMutationRule: params.protectedControlMutationRule,
      });
      await params.postText(
        renderManagedLoopStartedMessage({
          mode: "calendar",
          scheduleText: formatCalendarLoopSchedule({
            cadence: slashCommand.params.cadence,
            dayOfWeek: slashCommand.params.dayOfWeek,
            localTime: slashCommand.params.localTime,
          }),
          timezone: effectiveTimezone,
          nextRunAt: createdLoop?.nextRunAt,
          maintenancePrompt: resolvedLoopPrompt.maintenancePrompt,
          loopId: createdLoop?.id,
          maxRuns: createdLoop?.maxRuns,
          sessionLoopCount: params.agentService.listIntervalLoops({
            sessionKey: params.sessionTarget.sessionKey,
          }).length,
          globalLoopCount: params.agentService.getActiveIntervalLoopCount(),
          cancelCommand: "/loop cancel",
        }),
      );
      await params.agentService.recordConversationReply(params.sessionTarget);
      return interactionResult;
    }

    const createdLoop = await params.agentService.createIntervalLoop({
      target: params.sessionTarget,
      promptText: resolvedLoopPrompt.text,
      canonicalPromptText: resolvedLoopPrompt.text,
      promptSummary: summarizeManagedLoopPrompt(
        resolvedLoopPrompt.text,
        resolvedLoopPrompt.maintenancePrompt,
      ),
      promptSource: resolvedLoopPrompt.maintenancePrompt ? "LOOP.md" : "custom",
      surfaceBinding: buildLoopSurfaceBinding(params.identity),
      intervalMs: effectiveIntervalMs!,
      maxRuns: maxRunsPerLoop,
      createdBy: params.senderId,
      sender: buildLoopSender(params.identity),
      force: slashCommand.params.force,
      protectedControlMutationRule: params.protectedControlMutationRule,
    });
    await params.postText(
      renderManagedLoopStartedMessage({
        mode: "interval",
        intervalMs: effectiveIntervalMs,
        maintenancePrompt: resolvedLoopPrompt.maintenancePrompt,
        loopId: createdLoop?.id,
        maxRuns: createdLoop?.maxRuns,
        sessionLoopCount: params.agentService.listIntervalLoops({
          sessionKey: params.sessionTarget.sessionKey,
        }).length,
        globalLoopCount: params.agentService.getActiveIntervalLoopCount(),
        warning: validateManagedLoopInterval({
          intervalMs: effectiveIntervalMs!,
          force: slashCommand.params.force,
        }).warning,
        cancelCommand: "/loop cancel",
      }),
    );
    await params.agentService.recordConversationReply(params.sessionTarget);
    return interactionResult;
  }

  if (slashCommand?.type === "bash") {
    if (!slashCommand.command.trim()) {
      await params.postText("Usage: `/bash <command>` or a configured bash shortcut such as `!<command>`");
      return interactionResult;
    }

    const shellResult = await params.agentService.runShellCommand(
      params.sessionTarget,
      slashCommand.command,
    );
    const header = [
      `Bash in \`${shellResult.workspacePath}\``,
      `command: \`${shellResult.command}\``,
      shellResult.timedOut ? "exit: `124` timed out" : `exit: \`${shellResult.exitCode}\``,
    ].join("\n");
    const body = shellResult.output
      ? `\n\n\`\`\`text\n${escapeCodeFence(shellResult.output)}\n\`\`\``
      : "\n\n`(no output)`";
    await params.postText(`${header}${body}`);
    await params.agentService.recordConversationReply(params.sessionTarget);
    return interactionResult;
  }

  if (slashCommand?.type === "queue" && !explicitQueueMessage) {
    await params.postText("Usage: `/queue <message>` or `\\q <message>`");
    await params.agentService.recordConversationReply(params.sessionTarget);
    return interactionResult;
  }

  if (slashCommand?.type === "steer" && !explicitSteerMessage) {
    await params.postText("Usage: `/steer <message>` or `\\s <message>`");
    await params.agentService.recordConversationReply(params.sessionTarget);
    return interactionResult;
  }

  if (explicitSteerMessage) {
    const hasActiveRun = params.agentService.hasActiveRun?.(params.sessionTarget) ?? false;
    if (!hasActiveRun) {
      await params.postText("No active run to steer.");
      await params.agentService.recordConversationReply(params.sessionTarget);
      return interactionResult;
    }

    if (!canSteerActiveRun) {
      await params.postText(renderStartupSteeringUnavailableMessage());
      await params.agentService.recordConversationReply(params.sessionTarget);
      return interactionResult;
    }

    await params.agentService.submitSessionInput(
      params.sessionTarget,
      buildSteeringPromptText({
        text: params.transformSessionInputText?.(explicitSteerMessage) ?? explicitSteerMessage,
        identity: params.identity,
        agentId: params.route.agentId,
        time: Date.now(),
        promptContext: params.promptContext
          ? {
              ...params.promptContext,
              time: new Date().toISOString(),
            }
          : undefined,
        protectedControlMutationRule: params.protectedControlMutationRule,
      }),
    );
    if (params.onPromptAccepted) {
      await params.onPromptAccepted();
    }
    await params.postText("Steered.");
    await params.agentService.recordConversationReply(params.sessionTarget);
    return {
      processingIndicatorLifecycle: "active-run",
    };
  }

  if (!forceQueuedDelivery && params.route.additionalMessageMode === "steer") {
    if (sessionBusy && canSteerActiveRun) {
      await params.agentService.submitSessionInput(
        params.sessionTarget,
        buildSteeringPromptText({
          text: params.transformSessionInputText?.(params.text) ?? params.text,
          identity: params.identity,
          agentId: params.route.agentId,
          time: Date.now(),
          promptContext: params.promptContext
            ? {
                ...params.promptContext,
                time: new Date().toISOString(),
              }
            : undefined,
          protectedControlMutationRule: params.protectedControlMutationRule,
        }),
      );
      if (params.onPromptAccepted) {
        await params.onPromptAccepted();
      }
      return {
        processingIndicatorLifecycle: "active-run",
      };
    }
  }

  await executePromptDelivery({
    agentService: params.agentService,
    sessionTarget: params.sessionTarget,
    identity: params.identity,
    route: params.route,
    maxChars: params.maxChars,
    promptText: delayedPromptText,
    queueText: delayedPromptQueueText,
    queueStartMode: params.route.surfaceNotifications.queueStart,
    notificationPromptSummary:
      explicitQueueMessage ??
      summarizeSurfaceNotificationText(params.text),
    postText: params.postText,
    reconcileText: params.reconcileText,
    observerId,
    timingContext: params.timingContext,
    forceQueuedDelivery,
    onPromptAccepted: params.onPromptAccepted,
  });
  return interactionResult;
}
