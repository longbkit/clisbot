import {
  buildStoredLoopSender,
} from "../../agents/loops/loop-definition.ts";
import {
  createStoredQueueItem,
  type QueuedPromptStatus,
  type StoredQueueItem,
  type StoredQueueSender,
} from "../../agents/queue/queue-state.ts";
import { buildStoredSurfaceBinding } from "../../agents/routing/surface-binding.ts";
import type { ResolvedAgentTarget } from "../../agents/routing/resolved-target.ts";
import { DEFAULT_PROTECTED_CONTROL_RULE } from "../../auth/defaults.ts";
import { resolvePrincipalAuth } from "../../auth/resolve.ts";
import { resolveAgentTarget } from "../../agents/routing/resolved-target.ts";
import { AgentSessionState } from "../../agents/session/session-state.ts";
import { SessionStore } from "../../agents/session/session-store.ts";
import type {
  MessageChannel,
  MessageChildSurfaceSelector,
  ParsedMessageCommand,
} from "../../channels/message/message-command.ts";
import {
  listKnownChildSurfaceFlags,
  parseChildSurfaceSelector,
} from "../../channels/message/message-surface-helpers.ts";
import { getChannelPlugin, listChannelPlugins } from "../../channels/catalog/registry.ts";
import { ensureEditableConfigFile } from "../../config/core/config-file.ts";
import {
  loadConfig,
  loadConfigWithoutEnvResolution,
  resolveSessionStorePath,
} from "../../config/core/load-config.ts";
import { renderCliCommand } from "./cli-name.ts";
import {
  isRegisteredChannelId,
  renderChannelRequirementMessage,
  renderChannelNamePlaceholder,
  renderSenderPrincipalExamples,
  renderSupportedChannelsNote,
} from "../../channels/catalog/registry.ts";
import { normalizeChannelUserId } from "../../channels/integration/channel-surface-contract-registry.ts";
import { resolveLoopCliContext, type LoopCliContext } from "./loop-cli-context.ts";
import { hasFlag, parseBotOptionValue, parseOptionValue } from "./loop-cli-addressing.ts";

type QueueCliAddressing = {
  channel?: MessageChannel;
  target?: string;
  childSurface?: MessageChildSurfaceSelector;
  botId?: string;
  all: boolean;
};

type QueueControlState = Awaited<ReturnType<typeof loadQueueControlState>>;
type QueueCliContext = LoopCliContext;

const QUEUE_SENDER_FLAG = "--sender";
const QUEUE_SENDER_NAME_FLAG = "--sender-name";
const QUEUE_SENDER_HANDLE_FLAG = "--sender-handle";

type QueueCreatedNotificationParams = {
  state: QueueControlState;
  context: QueueCliContext;
  resolved: ResolvedAgentTarget;
  item: StoredQueueItem;
  positionAhead: number;
  text: string;
};

type QueueCliDependencies = {
  print: (text: string) => void;
  warn: (text: string) => void;
  sendQueueCreatedNotification: (params: QueueCreatedNotificationParams) => Promise<void>;
};

const defaultQueueCliDependencies: QueueCliDependencies = {
  print: (text) => console.log(text),
  warn: (text) => console.warn(text),
  sendQueueCreatedNotification: sendQueueCreatedNotificationToSurface,
};

function getEditableConfigPath() {
  return process.env.CLISBOT_CONFIG_PATH;
}

function getSessionState(sessionStorePath: string) {
  return new AgentSessionState(new SessionStore(sessionStorePath));
}

async function loadQueueControlState() {
  const configPath = await ensureEditableConfigFile(getEditableConfigPath());
  const loadedConfig = await loadConfigWithoutEnvResolution(configPath);
  const sessionStorePath = resolveSessionStorePath(loadedConfig);
  return {
    loadedConfig,
    configPath: loadedConfig.configPath,
    sessionStorePath,
    sessionState: getSessionState(sessionStorePath),
  };
}

function parseQueueCliAddressing(args: string[]): QueueCliAddressing {
  if (parseOptionValue(args, "--surface") || parseOptionValue(args, "--session-key")) {
    throw new Error("Queue commands use --channel/--target addressing; --surface and --session-key are not supported.");
  }
  const channel = parseOptionValue(args, "--channel");
  if (channel && !isRegisteredChannelId(channel)) {
    throw new Error(renderChannelRequirementMessage("--channel"));
  }
  const addressing = {
    channel: channel as MessageChannel | undefined,
    target: parseOptionValue(args, "--target"),
    botId: parseBotOptionValue(args),
    all: hasFlag(args, "--all"),
  };
  const childSurface = parseChildSurfaceSelector({
    args,
    channel: addressing.channel,
    scopeLabel: "queue commands",
    allowAliasFlags: true,
  });
  return {
    ...addressing,
    childSurface,
  };
}

function resolveScopedContext(
  state: QueueControlState,
  addressing: QueueCliAddressing,
): QueueCliContext {
  if (!addressing.channel || !addressing.target) {
    throw new Error("--channel and --target are required for scoped queue commands.");
  }
  return resolveLoopCliContext({
    loadedConfig: state.loadedConfig,
    channel: addressing.channel,
    target: addressing.target,
    childSurface: addressing.childSurface,
    botId: addressing.botId,
  });
}

async function enforceQueueCreateLimit(
  state: QueueControlState,
  sessionKey: string,
) {
  const maxPending =
    state.loadedConfig.raw.control.queue?.maxPendingItemsPerSession ?? 20;
  const pendingCount =
    await state.sessionState.countPendingQueuedItemsForSessionKey(sessionKey);
  if (pendingCount >= maxPending) {
    throw new Error(
      `Session queue pending item count exceeds the configured max of \`${maxPending}\`. Clear pending queue items first.`,
    );
  }
}

function parseQueueSender(args: string[], addressing: QueueCliAddressing): StoredQueueSender {
  const sender = parseOptionValue(args, QUEUE_SENDER_FLAG)?.trim();
  if (!sender) {
    throw new Error(
      `Queue creation requires ${QUEUE_SENDER_FLAG} <principal>, for example ${QUEUE_SENDER_FLAG} ${renderSenderPrincipalExamples(addressing.channel ? [addressing.channel] : undefined).replaceAll(", ", `, ${QUEUE_SENDER_FLAG} `)}.`,
    );
  }
  const [platform, ...providerParts] = sender.split(":");
  const providerId = providerParts.join(":").trim();
  if (!isRegisteredChannelId(platform) || !providerId) {
    throw new Error(`--sender must be a principal like ${renderSenderPrincipalExamples(addressing.channel ? [addressing.channel] : undefined)}.`);
  }
  if (addressing.channel && platform !== addressing.channel) {
    throw new Error(`--sender platform must match --channel ${addressing.channel}.`);
  }
  const creator = buildStoredLoopSender({
    platform,
    providerId: normalizeChannelUserId(platform, providerId),
    displayName: parseOptionValue(args, QUEUE_SENDER_NAME_FLAG),
    handle: parseOptionValue(args, QUEUE_SENDER_HANDLE_FLAG),
  });
  if (!creator) {
    throw new Error("--sender must include a non-empty provider id.");
  }
  return creator;
}

function assertQueueSenderMatchesContext(sender: StoredQueueSender, context: LoopCliContext) {
  const senderPlatform = sender.senderId?.split(":", 1)[0];
  if (senderPlatform && senderPlatform !== context.channel) {
    throw new Error(`--sender platform must match target channel ${context.channel}.`);
  }
}

function stripQueueArgs(args: string[]) {
  const valueFlags = new Set([
    "--channel",
    "--target",
    "--bot",
    "--account",
    QUEUE_SENDER_FLAG,
    QUEUE_SENDER_NAME_FLAG,
    QUEUE_SENDER_HANDLE_FLAG,
  ]);
  const remaining: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--") {
      remaining.push(...args.slice(index + 1));
      break;
    }
    if (valueFlags.has(args[index]) || listKnownChildSurfaceFlags().includes(args[index])) {
      index += 1;
      continue;
    }
    if (args[index] !== "--all") {
      remaining.push(args[index]);
    }
  }
  return remaining;
}

function buildQueueSurfaceBinding(context: LoopCliContext) {
  return buildStoredSurfaceBinding({
    ...context.identity,
    botId: context.botId,
  });
}

function resolveProtectedControlMutationRule(
  state: QueueControlState,
  agentId: string,
  sender: StoredQueueSender,
) {
  const auth = resolvePrincipalAuth({
    config: state.loadedConfig.raw,
    agentId,
    principal: sender.senderId,
  });
  return auth.mayManageProtectedResources ? undefined : DEFAULT_PROTECTED_CONTROL_RULE;
}

function createQueueItemForContext(params: {
  state: QueueControlState;
  context: LoopCliContext;
  promptText: string;
  sender: StoredQueueSender;
}) {
  return createStoredQueueItem({
    promptText: params.promptText,
    protectedControlMutationRule: resolveProtectedControlMutationRule(
      params.state,
      params.context.sessionTarget.agentId,
      params.sender,
    ),
    promptSummary: params.promptText,
    createdBy: params.sender.providerId,
    sender: params.sender,
    surfaceBinding: buildQueueSurfaceBinding(params.context),
  });
}

export function renderQueueCreatedNotification(params: {
  queueId: string;
  positionAhead: number;
  promptText: string;
}) {
  const queueLine =
    params.positionAhead > 0
      ? `Queued \`${params.queueId}\`: ${params.positionAhead} ahead.`
      : `Queued \`${params.queueId}\`.`;
  return `${queueLine}\n\n${params.promptText.trim()}`;
}

async function getQueuePositionAhead(
  state: QueueControlState,
  sessionKey: string,
  itemId: string,
) {
  const queues = await state.sessionState.listQueuedItems({
    sessionKey,
    statuses: ["pending", "running"],
  });
  const index = queues.findIndex((item) => item.id === itemId);
  return index >= 0 ? index : 0;
}

function buildQueueCreatedMessageCommand(params: {
  context: QueueCliContext;
  text: string;
}): ParsedMessageCommand {
  return {
    kind: "shared",
    action: "send",
    channel: params.context.channel,
    account: params.context.botId,
    target: params.context.target,
    childSurface: params.context.childSurface,
    message: params.text,
    remove: false,
    pollOptions: [],
    forceDocument: false,
    silent: false,
    progress: false,
    final: false,
    json: false,
    inputFormat: "plain",
    renderMode: "none",
  };
}

async function sendQueueCreatedNotificationToSurface(
  params: QueueCreatedNotificationParams,
) {
  if (!params.item.surfaceBinding) {
    return;
  }
  const loadedConfig = await loadConfig(params.state.configPath, {
    materializeChannels: [params.context.channel],
  });
  const plugin = listChannelPlugins().find((entry) => entry.id === params.context.channel);
  if (!plugin) {
    throw new Error(`Unsupported queue notification channel: ${params.context.channel}`);
  }
  const command = buildQueueCreatedMessageCommand({
    context: params.context,
    text: params.text,
  });
  await plugin.runMessageCommand(
    loadedConfig,
    command,
    plugin.resolveMessageSurface(command),
  );
  await params.state.sessionState.recordConversationReply(params.resolved);
}

function renderQueueInventory(params: {
  commandLabel: "list" | "status";
  sessionStorePath: string;
  queues: QueuedPromptStatus[];
}) {
  const lines = [
    `Queue ${params.commandLabel}`,
    "",
    `sessionStore: \`${params.sessionStorePath}\``,
    `items: \`${params.queues.length}\``,
    "",
  ];
  for (const item of params.queues) {
    lines.push(
      `- id: \`${item.id}\` status: \`${item.status}\` sessionKey: \`${item.sessionKey}\` queuedAt: \`${new Date(item.createdAt).toISOString()}\` prompt: \`${item.promptSummary}\``,
    );
  }
  return lines.join("\n");
}

async function listQueues(
  state: QueueControlState,
  addressing: QueueCliAddressing,
  commandLabel: "list" | "status",
  deps: QueueCliDependencies,
) {
  const context = addressing.channel || addressing.target
    ? resolveScopedContext(state, addressing)
    : undefined;
  const sessionKey = context?.sessionTarget.sessionKey;
  const queues = await state.sessionState.listQueuedItems({
    sessionKey,
    statuses: commandLabel === "list" ? ["pending"] : ["pending", "running"],
  });
  deps.print(
    renderQueueInventory({
      commandLabel,
      sessionStorePath: state.sessionStorePath,
      queues,
    }),
  );
}

async function createQueue(
  state: QueueControlState,
  args: string[],
  deps: QueueCliDependencies,
) {
  const addressing = parseQueueCliAddressing(args);
  const promptText = stripQueueArgs(args.slice(1)).join(" ").trim();
  if (!promptText) {
    throw new Error("Queue creation requires a prompt.");
  }
  const sender = parseQueueSender(args, addressing);
  if (!addressing.channel || !addressing.target) {
    throw new Error("Queue creation requires --channel/--target.");
  }
  const context = resolveScopedContext(state, addressing);
  assertQueueSenderMatchesContext(sender, context);
  const resolved = resolveAgentTarget(state.loadedConfig, context.sessionTarget);
  await enforceQueueCreateLimit(state, context.sessionTarget.sessionKey);
  const item = createQueueItemForContext({
    state,
    context,
    promptText,
    sender,
  });
  await state.sessionState.setQueuedItem(resolved, item);
  const positionAhead = await getQueuePositionAhead(
    state,
    context.sessionTarget.sessionKey,
    item.id,
  );
  const text = renderQueueCreatedNotification({ queueId: item.id, positionAhead, promptText });
  await deps.sendQueueCreatedNotification({
    state,
    context,
    resolved,
    item,
    positionAhead,
    text,
  }).catch((error) => {
    deps.warn(`Queued prompt ${item.id}, but surface acknowledgement failed: ${String(error)}`);
  });
  deps.print(`Queued prompt \`${item.id}\` for \`${context.sessionTarget.sessionKey}\`.`);
}

async function clearQueues(
  state: QueueControlState,
  addressing: QueueCliAddressing,
  deps: QueueCliDependencies,
) {
  if (addressing.all) {
    const cleared = await state.sessionState.clearAllPendingQueuedItems();
    deps.print(
      `Cleared ${cleared.length} pending queued prompt${cleared.length === 1 ? "" : "s"} across the whole app.`,
    );
    return;
  }
  const context = resolveScopedContext(state, addressing);
  const sessionKey = context.sessionTarget.sessionKey;
  const cleared = await state.sessionState.clearPendingQueuedItemsForSessionKey(sessionKey);
  deps.print(
    `Cleared ${cleared.length} pending queued prompt${cleared.length === 1 ? "" : "s"} for \`${sessionKey}\`.`,
  );
}

function renderQueueTargetingHelp(channel?: MessageChannel) {
  return channel
    ? getChannelPlugin(channel)?.renderControlTargetingHelpLines?.() ?? []
    : [
      `  - use ${renderCliCommand(`queues --help --channel ${renderChannelNamePlaceholder()}`)} for channel-specific target syntax`,
      "  - channel child-surface flags are owned by each channel plugin",
    ];
}

function renderQueueExamples(channel?: MessageChannel) {
  return channel
    ? getChannelPlugin(channel)?.renderQueueExampleLines?.() ?? []
    : listChannelPlugins().flatMap((plugin) => plugin.renderQueueExampleLines?.() ?? []);
}

export function renderQueuesHelp(channel?: MessageChannel) {
  const channelName = renderChannelNamePlaceholder();
  return [
    "clisbot queues",
    "",
    "Usage:",
    `  ${renderCliCommand(`queues list [--channel ${channelName} --target <route>]`)}`,
    `  ${renderCliCommand(`queues status [--channel ${channelName} --target <route>]`)}`,
    `  ${renderCliCommand(`queues create --channel ${channelName} --target <route> --sender <principal> <prompt...>`)}`,
    `  ${renderCliCommand(`queues clear --channel ${channelName} --target <route>`)}`,
    `  ${renderCliCommand("queues clear --all")}`,
    "",
    "Targets:",
    ...renderQueueTargetingHelp(channel),
    `  - \`--sender <principal>\` should use ${renderSenderPrincipalExamples(channel ? [channel] : undefined)}`,
    "",
    "Examples:",
    ...renderQueueExamples(channel),
    "",
    "Notes:",
    "  list shows pending queue items only; status shows pending and running queue items.",
    "  clear removes pending queue items only and does not interrupt a running prompt.",
    "  create is capped by control.queue.maxPendingItemsPerSession, default 20.",
    "  create requires explicit --channel/--target addressing plus --sender; --current is not supported.",
    `  ${renderSupportedChannelsNote()}`,
  ].join("\n");
}

export async function runQueuesCli(
  args: string[],
  dependencies: Partial<QueueCliDependencies> = {},
) {
  const deps = { ...defaultQueueCliDependencies, ...dependencies };
  if (
    args[0] === "--help" ||
    args[0] === "help" ||
    args[1] === "--help" ||
    args[1] === "help" ||
    args.length === 0
  ) {
    const helpChannel = parseOptionValue(args, "--channel");
    let channel: MessageChannel | undefined;
    if (helpChannel) {
      if (!isRegisteredChannelId(helpChannel)) {
        throw new Error(renderChannelRequirementMessage("--channel"));
      }
      channel = helpChannel;
    }
    deps.print(renderQueuesHelp(channel));
    return;
  }
  const command = args[0];
  const state = await loadQueueControlState();
  if (command === "list" || command === "status") {
    await listQueues(state, parseQueueCliAddressing(args.slice(1)), command, deps);
    return;
  }
  if (command === "create") {
    await createQueue(state, args, deps);
    return;
  }
  if (command === "clear") {
    await clearQueues(state, parseQueueCliAddressing(args.slice(1)), deps);
    return;
  }
  throw new Error(`Unknown queues subcommand: ${command}`);
}
