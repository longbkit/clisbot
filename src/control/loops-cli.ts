import {
  AgentService,
  ActiveRunInProgressError,
  type AgentSessionTarget,
} from "../agents/agent-service.ts";
import {
  createStoredCalendarLoop,
  createStoredIntervalLoop,
  renderLoopStartedMessage,
  resolveLoopPromptText,
  summarizeLoopPrompt,
  validateLoopInterval,
} from "../agents/loop-control-shared.ts";
import type { IntervalLoopStatus } from "../agents/loop-state.ts";
import {
  LOOP_APP_FLAG,
  computeNextCalendarLoopRunAtMs,
  formatCalendarLoopSchedule,
  parseLoopSlashCommand,
  type ParsedLoopSlashCommand,
} from "../agents/loop-command.ts";
import { resolveAgentTarget } from "../agents/resolved-target.ts";
import { AgentSessionState } from "../agents/session-state.ts";
import { SessionStore } from "../agents/session-store.ts";
import { ensureEditableConfigFile } from "../config/config-file.ts";
import {
  loadConfigWithoutEnvResolution,
  resolveSessionStorePath,
} from "../config/load-config.ts";
import { parseTimezone, resolveConfigTimezone } from "../config/timezone.ts";
import { getRuntimeStatus } from "./runtime-process.ts";
import { resolveLoopCliContext } from "./loop-cli-context.ts";
import {
  hasFlag,
  hasLoopContext,
  parseAddressing,
  parseOptionValue,
  resolveLoopSubtargetId,
  stripLoopContextArgs,
  type LoopCliAddressing,
} from "./loop-cli-addressing.ts";
import {
  renderLoopInventory,
  renderLoopsHelp,
  renderLoopStoreSummary,
  renderScopedCommand,
  renderScopedLoopStatus,
} from "./loops-cli-rendering.ts";
import {
  getScopedLoopCounts,
  prepareLoopCreateAddressing,
  removeScopedLoopsById,
  resolveSlackSurfaceChannelId,
  selectScopedLoopsForAddressing,
} from "./loop-cli-targeting.ts";
import { renderCliCommand } from "../shared/cli-name.ts";
import { sleep } from "../shared/process.ts";

export { renderLoopsHelp } from "./loops-cli-rendering.ts";

const LOOP_BUSY_RETRY_MS = 250;
const LOOP_CONFIRM_FLAG = "--confirm";

type LoadedLoopControlState = Awaited<ReturnType<typeof loadLoopControlState>>;
type LoopCliContext = ReturnType<typeof resolveLoopCliContext>;
type LoopPromptResolution = Awaited<ReturnType<typeof resolveLoopPromptText>>;
type LoopCreateRequest = {
  addressing: LoopCliAddressing;
  context: LoopCliContext;
  deliveryContext?: LoopCliContext;
  parsed: ParsedLoopSlashCommand;
  resolvedPrompt: LoopPromptResolution;
  resolvedTarget: ReturnType<typeof resolveAgentTarget>;
  maxRunsPerLoop: number;
  maxActiveLoops: number;
  expression: string;
  confirm: boolean;
  loopTimezone?: string;
};
type LoopCounts = {
  sessionLoopCount: number;
  globalLoopCount: number;
};
type LoopCreateBase = {
  state: LoadedLoopControlState;
  request: LoopCreateRequest;
  cancelCommand: string;
  runtimeRunning: boolean;
};

function getEditableConfigPath() {
  return process.env.CLISBOT_CONFIG_PATH;
}

function getSessionState(sessionStorePath: string) {
  return new AgentSessionState(new SessionStore(sessionStorePath));
}

async function loadLoopControlState() {
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

function requireLoopContext(addressing: LoopCliAddressing) {
  if (!addressing.channel || !addressing.target) {
    throw new Error("--channel and --target are required for scoped loop commands.");
  }
}

function resolveScopedLoopContext(
  state: LoadedLoopControlState,
  addressing: LoopCliAddressing,
) {
  requireLoopContext(addressing);
  if (addressing.channel === "telegram" && addressing.threadId) {
    throw new Error("Telegram loop commands use `--topic-id`, not `--thread-id`.");
  }
  return resolveLoopCliContext({
    loadedConfig: state.loadedConfig,
    channel: addressing.channel!,
    target: addressing.target!,
    threadId: resolveLoopSubtargetId(addressing),
    topicId: addressing.topicId,
    botId: addressing.botId,
  });
}

async function listLoops(state: LoadedLoopControlState, commandLabel: "list" | "status") {
  const loops = await state.sessionState.listIntervalLoops();
  console.log(
    renderLoopInventory({
      commandLabel,
      configPath: state.configPath,
      sessionStorePath: state.sessionStorePath,
      loops,
    }),
  );
}

async function showScopedStatus(state: LoadedLoopControlState, addressing: LoopCliAddressing) {
  const context = resolveScopedLoopContext(state, addressing);
  const sessionLoops = selectScopedLoopsForAddressing(
    context,
    addressing,
    await state.sessionState.listIntervalLoops({
      sessionKey: context.sessionTarget.sessionKey,
    }),
  );
  const globalLoopCount = (await state.sessionState.listIntervalLoops()).length;
  console.log(
    renderScopedLoopStatus({
      commandLabel: renderScopedCommand("loops status", addressing),
      configPath: state.configPath,
      sessionStorePath: state.sessionStorePath,
      sessionKey: context.sessionTarget.sessionKey,
      sessionLoops,
      globalLoopCount,
    }),
  );
}

async function cancelLoopById(state: LoadedLoopControlState, loopId: string) {
  const cancelled = await state.sessionState.removeIntervalLoopById(loopId);
  const remaining = await state.sessionState.listIntervalLoops();
  console.log(
    [
      cancelled
        ? `Cancelled loop \`${loopId}\`.`
        : `No active loop found with id \`${loopId}\`.`,
      ...renderLoopStoreSummary(state.sessionStorePath, remaining.length),
    ].join("\n"),
  );
}

async function cancelAllLoops(state: LoadedLoopControlState) {
  const cancelled = await state.sessionState.clearAllIntervalLoops();
  const remaining = await state.sessionState.listIntervalLoops();
  console.log(
    [
      cancelled > 0
        ? `Cancelled ${cancelled} active loop${cancelled === 1 ? "" : "s"} across the whole app.`
        : "No active loops to cancel across the whole app.",
      ...renderLoopStoreSummary(state.sessionStorePath, remaining.length),
    ].join("\n"),
  );
}

function resolveScopedLoopCancelId(args: string[], sessionLoops: IntervalLoopStatus[]) {
  const explicitLoopId = stripLoopContextArgs(args.slice(1))
    .find((token) => token && token !== "--all" && token !== LOOP_APP_FLAG);
  return explicitLoopId || (sessionLoops.length === 1 ? sessionLoops[0]?.id : undefined);
}

async function cancelAllScopedLoops(
  state: LoadedLoopControlState,
  context: LoopCliContext,
  sessionLoops: IntervalLoopStatus[],
) {
  if (sessionLoops.length > 0) {
    await removeScopedLoopsById(
      {
        loadedConfig: state.loadedConfig,
        sessionState: state.sessionState,
        context,
        loopIds: sessionLoops.map((loop) => loop.id),
      },
    );
  }
  const remaining = await state.sessionState.listIntervalLoops();
  console.log(
    [
      sessionLoops.length > 0
        ? `Cancelled ${sessionLoops.length} active loop${sessionLoops.length === 1 ? "" : "s"} for this session.`
        : "No active loops to cancel for this session.",
      ...renderLoopStoreSummary(state.sessionStorePath, remaining.length),
    ].join("\n"),
  );
}

async function cancelOneScopedLoop(
  state: LoadedLoopControlState,
  context: LoopCliContext,
  sessionLoops: IntervalLoopStatus[],
  targetLoopId: string,
) {
  await removeScopedLoopsById({
    loadedConfig: state.loadedConfig,
    sessionState: state.sessionState,
    context,
    loopIds: [targetLoopId],
  });
  const remaining = await state.sessionState.listIntervalLoops();
  console.log(
    [
      sessionLoops.some((loop) => loop.id === targetLoopId)
        ? `Cancelled loop \`${targetLoopId}\`.`
        : `No active loop found with id \`${targetLoopId}\`.`,
      ...renderLoopStoreSummary(state.sessionStorePath, remaining.length),
    ].join("\n"),
  );
}

async function cancelScopedLoops(
  state: LoadedLoopControlState,
  args: string[],
  addressing: LoopCliAddressing,
) {
  const context = resolveScopedLoopContext(state, addressing);
  const all = hasFlag(args, "--all");
  const app = hasFlag(args, LOOP_APP_FLAG);
  if (app && !all) {
    throw new Error(`\`${LOOP_APP_FLAG}\` only works with \`cancel --all\`.`);
  }

  if (all && app) {
    await cancelAllLoops(state);
    return;
  }

  const sessionLoops = selectScopedLoopsForAddressing(
    context,
    addressing,
    await state.sessionState.listIntervalLoops({
      sessionKey: context.sessionTarget.sessionKey,
    }),
  );
  if (all) {
    await cancelAllScopedLoops(state, context, sessionLoops);
    return;
  }

  const targetLoopId = resolveScopedLoopCancelId(args, sessionLoops);
  if (!targetLoopId) {
    console.log(
      sessionLoops.length === 0
        ? "No active loops to cancel for this session."
        : `Multiple active loops exist for this session. Use ${renderCliCommand("loops cancel --channel <...> --target <...> <id>", { inline: true })} or ${renderCliCommand("loops cancel --channel <...> --target <...> --all", { inline: true })}.`,
    );
    return;
  }

  await cancelOneScopedLoop(state, context, sessionLoops, targetLoopId);
}

async function waitForSessionIdle(agentService: AgentService, target: AgentSessionTarget) {
  while (true) {
    try {
      const runtime = await agentService.getSessionRuntime(target);
      if (runtime.state !== "running") {
        return;
      }
    } catch {
      return;
    }
    await sleep(LOOP_BUSY_RETRY_MS);
  }
}

async function executeCountLoop(params: {
  state: LoadedLoopControlState;
  context: LoopCliContext;
  promptText: string;
  count: number;
  maintenancePrompt: boolean;
}) {
  const agentService = new AgentService(params.state.loadedConfig);
  const builtPrompt = params.context.buildLoopPromptText(params.promptText);
  console.log(
    renderLoopStartedMessage({
      mode: "times",
      count: params.count,
      maintenancePrompt: params.maintenancePrompt,
    }),
  );

  try {
    for (let index = 0; index < params.count; index += 1) {
      while (true) {
        await waitForSessionIdle(agentService, params.context.sessionTarget);
        try {
          await agentService.enqueuePrompt(params.context.sessionTarget, builtPrompt, {
            onUpdate: () => undefined,
          }).result;
          break;
        } catch (error) {
          if (!(error instanceof ActiveRunInProgressError)) {
            throw error;
          }
          await sleep(LOOP_BUSY_RETRY_MS);
        }
      }
    }
  } finally {
    await agentService.stop();
  }

  console.log(`Completed ${params.count} iteration${params.count === 1 ? "" : "s"}.`);
}

function stripConfirmFlag(args: string[]) {
  return args.filter((arg) => arg !== LOOP_CONFIRM_FLAG);
}

function parseCreateExpression(rawArgs: string[], explicitCreateSubcommand: boolean) {
  const expressionArgs = stripLoopContextArgs(
    stripConfirmFlag(explicitCreateSubcommand ? rawArgs.slice(1) : rawArgs),
  );
  const expression = expressionArgs.join(" ").trim();
  if (!expression) {
    throw new Error("Loop creation requires an interval, count, or schedule expression.");
  }
  return expression;
}

function parseCreateCommand(expression: string) {
  const parsed = parseLoopSlashCommand(expression);
  if ("error" in parsed) {
    throw new Error(parsed.error);
  }
  return parsed;
}

function parseLoopTimezone(args: string[]) {
  const timezone = parseOptionValue(args, "--timezone");
  if (!timezone) {
    return undefined;
  }
  return parseTimezone(timezone, "--timezone");
}

async function enforceLoopCreateLimits(
  state: LoadedLoopControlState,
  parsed: ParsedLoopSlashCommand,
  maxRunsPerLoop: number,
  maxActiveLoops: number,
) {
  const globalLoops = await state.sessionState.listIntervalLoops();
  if (parsed.mode !== "times" && globalLoops.length >= maxActiveLoops) {
    throw new Error(
      `Active loop count exceeds the configured max of \`${maxActiveLoops}\`. Cancel an existing loop first.`,
    );
  }
  if (parsed.mode === "times" && parsed.count > maxRunsPerLoop) {
    throw new Error(`Loop count exceeds the configured max of \`${maxRunsPerLoop}\`.`);
  }
}

function requireValidIntervalLoop(parsed: Extract<ParsedLoopSlashCommand, { mode: "interval" }>) {
  const validation = validateLoopInterval({
    intervalMs: parsed.intervalMs,
    force: parsed.force,
  });
  if (validation.error) {
    throw new Error(validation.error);
  }
  return validation;
}

async function resolveLoopCreateRequest(
  state: LoadedLoopControlState,
  rawArgs: string[],
  explicitCreateSubcommand: boolean,
): Promise<LoopCreateRequest> {
  const confirm = hasFlag(rawArgs, LOOP_CONFIRM_FLAG);
  const loopTimezone = parseLoopTimezone(rawArgs);
  const expression = parseCreateExpression(rawArgs, explicitCreateSubcommand);
  const parsed = parseCreateCommand(expression);
  let addressing = parseAddressing(rawArgs);
  if (addressing.channel === "telegram" && addressing.threadId) {
    throw new Error("Telegram loop commands use `--topic-id`, not `--thread-id`.");
  }
  const loopConfig = state.loadedConfig.raw.control.loop;
  const maxRunsPerLoop = loopConfig.maxRunsPerLoop ?? loopConfig.maxTimes ?? 50;
  const maxActiveLoops = loopConfig.maxActiveLoops ?? 10;
  await enforceLoopCreateLimits(state, parsed, maxRunsPerLoop, maxActiveLoops);
  const provisionalContext = resolveScopedLoopContext(state, addressing);
  const provisionalResolvedTarget = resolveAgentTarget(
    state.loadedConfig,
    provisionalContext.sessionTarget,
  );
  const resolvedPrompt = await resolveLoopPromptText({
    workspacePath: provisionalResolvedTarget.workspacePath,
    promptText: parsed.promptText,
  });
  if (parsed.mode === "calendar" && !confirm && !(await hasSuccessfulCalendarLoop(state))) {
    return {
      addressing,
      context: provisionalContext,
      parsed,
      resolvedPrompt,
      resolvedTarget: provisionalResolvedTarget,
      maxRunsPerLoop,
      maxActiveLoops,
      expression,
      confirm,
      loopTimezone,
    };
  }
  addressing = await prepareLoopCreateAddressing({
    configPath: state.configPath,
    rawArgs,
    parsed,
    resolvedPrompt,
  });
  const surfaceChannelId = await resolveSlackSurfaceChannelId({
    configPath: state.configPath,
    addressing,
  });
  const context = resolveScopedLoopContext(state, addressing);
  const deliveryContext =
    surfaceChannelId && surfaceChannelId !== context.identity.channelId
      ? resolveScopedLoopContext(state, {
          ...addressing,
          target: surfaceChannelId,
        })
      : undefined;
  const resolvedTarget = resolveAgentTarget(state.loadedConfig, context.sessionTarget);
  return {
    addressing,
    context,
    deliveryContext,
    parsed,
    resolvedPrompt,
    resolvedTarget,
    maxRunsPerLoop,
    maxActiveLoops,
    expression,
    confirm,
    loopTimezone,
  };
}

function buildLoopSurfaceBinding(request: LoopCreateRequest) {
  const context = request.deliveryContext ?? request.context;
  return {
    platform: context.identity.platform,
    botId: context.botId,
    conversationKind: context.identity.conversationKind,
    channelId: context.identity.channelId,
    chatId: context.identity.chatId,
    threadTs: context.identity.threadTs,
    topicId: context.identity.topicId,
  };
}

function buildRecurringLoopCreateBase(
  state: LoadedLoopControlState,
  request: LoopCreateRequest,
): Promise<LoopCreateBase> {
  return getRuntimeStatus().then((runtimeStatus) => ({
    state,
    request,
    cancelCommand: renderScopedCommand("loops cancel", request.addressing),
    runtimeRunning: runtimeStatus.running,
  }));
}

function buildRecurringLoopPromptMetadata(request: LoopCreateRequest) {
  return {
    promptText: request.resolvedPrompt.text,
    canonicalPromptText: request.resolvedPrompt.text,
    promptSummary: summarizeLoopPrompt(
      request.resolvedPrompt.text,
      request.resolvedPrompt.maintenancePrompt,
    ),
    promptSource: request.resolvedPrompt.maintenancePrompt
      ? ("LOOP.md" as const)
      : ("custom" as const),
    maintenancePrompt: request.resolvedPrompt.maintenancePrompt,
    surfaceBinding: buildLoopSurfaceBinding(request),
  };
}

function buildRecurringLoopFirstRunNote(mode: "interval" | "calendar", runtimeRunning: boolean) {
  if (!runtimeRunning) {
    return "Runtime is not running, so this loop activates on the next `clisbot start`.";
  }
  if (mode === "interval") {
    return "The first run starts after the runtime reconciles this new loop.";
  }
  return undefined;
}

async function createCalendarLoop(base: LoopCreateBase) {
  const parsed = base.request.parsed;
  if (parsed.mode !== "calendar") {
    return false;
  }

  const metadata = buildRecurringLoopPromptMetadata(base.request);
  const timezone = resolveConfigTimezone({
    config: base.state.loadedConfig.raw,
    agentId: base.request.context.sessionTarget.agentId,
    routeTimezone: base.request.context.route.timezone,
    botTimezone: base.request.context.route.botTimezone,
    loopTimezone: base.request.loopTimezone,
  }).timezone;
  const loop = createStoredCalendarLoop({
    ...metadata,
    cadence: parsed.cadence,
    dayOfWeek: parsed.dayOfWeek,
    localTime: parsed.localTime,
    hour: parsed.hour,
    minute: parsed.minute,
    timezone,
    maxRuns: base.request.maxRunsPerLoop,
  });
  await base.state.sessionState.setIntervalLoop(base.request.resolvedTarget, loop);
  const counts = await getScopedLoopCounts({
    sessionState: base.state.sessionState,
    sessionKey: base.request.context.sessionTarget.sessionKey,
    context: base.request.context,
    addressing: base.request.addressing,
  });
  console.log(
    renderLoopStartedMessage({
      mode: "calendar",
      scheduleText: formatCalendarLoopSchedule(parsed),
      timezone: loop.timezone,
      nextRunAt: loop.nextRunAt,
      maintenancePrompt: metadata.maintenancePrompt,
      loopId: loop.id,
      maxRuns: loop.maxRuns,
      cancelCommand: base.cancelCommand,
      firstRunNote: buildRecurringLoopFirstRunNote("calendar", base.runtimeRunning),
      ...counts,
    }),
  );
  return true;
}

async function hasSuccessfulCalendarLoop(state: LoadedLoopControlState) {
  return (await state.sessionState.listIntervalLoops()).some((loop) => loop.kind === "calendar");
}

function renderCalendarConfirmation(params: {
  request: LoopCreateRequest;
  timezone: string;
}) {
  const parsed = params.request.parsed;
  if (parsed.mode !== "calendar") {
    return "";
  }
  const nextRunAt = computeNextCalendarLoopRunAtMs({
    cadence: parsed.cadence,
    dayOfWeek: parsed.dayOfWeek,
    hour: parsed.hour,
    minute: parsed.minute,
    timezone: params.timezone,
    nowMs: Date.now(),
  });
  const timezoneClause = params.request.loopTimezone ? ` --timezone ${params.request.loopTimezone}` : "";
  const retryCommand = `${renderScopedCommand("loops create", params.request.addressing)}${timezoneClause} ${params.request.expression} ${LOOP_CONFIRM_FLAG}`;
  return [
    "confirmation_required: first wall-clock loop",
    `proposed schedule: ${formatCalendarLoopSchedule(parsed)}`,
    `timezone: ${params.timezone}`,
    nextRunAt ? `next run: ${new Date(nextRunAt).toISOString()}` : "next run: unknown",
    "",
    "Confirm this timezone and schedule before creating the first wall-clock loop.",
    `If timezone is wrong, set it first with ${renderCliCommand("timezone set <iana-timezone>", { inline: true })}.`,
    "",
    "If correct, rerun with:",
    retryCommand,
  ].join("\n");
}

async function createIntervalLoop(base: LoopCreateBase) {
  const parsed = base.request.parsed;
  if (parsed.mode !== "interval") {
    return;
  }

  const validation = requireValidIntervalLoop(parsed);
  const metadata = buildRecurringLoopPromptMetadata(base.request);
  const loop = createStoredIntervalLoop({
    ...metadata,
    intervalMs: parsed.intervalMs,
    maxRuns: base.request.maxRunsPerLoop,
    force: parsed.force,
  });
  await base.state.sessionState.setIntervalLoop(base.request.resolvedTarget, loop);
  const counts = await getScopedLoopCounts({
    sessionState: base.state.sessionState,
    sessionKey: base.request.context.sessionTarget.sessionKey,
    context: base.request.context,
    addressing: base.request.addressing,
  });
  console.log(
    renderLoopStartedMessage({
      mode: "interval",
      intervalMs: parsed.intervalMs,
      maintenancePrompt: metadata.maintenancePrompt,
      loopId: loop.id,
      maxRuns: loop.maxRuns,
      warning: validation.warning,
      cancelCommand: base.cancelCommand,
      firstRunNote: buildRecurringLoopFirstRunNote("interval", base.runtimeRunning),
      ...counts,
    }),
  );
}

async function createRecurringLoop(
  state: LoadedLoopControlState,
  request: LoopCreateRequest,
) {
  const base = await buildRecurringLoopCreateBase(state, request);
  if (await createCalendarLoop(base)) {
    return;
  }
  await createIntervalLoop(base);
}

async function createLoop(
  state: LoadedLoopControlState,
  rawArgs: string[],
  options: {
    explicitCreateSubcommand?: boolean;
  } = {},
) {
  const request = await resolveLoopCreateRequest(
    state,
    rawArgs,
    options.explicitCreateSubcommand ?? false,
  );
  if (request.parsed.mode === "times") {
    await executeCountLoop({
      state,
      context: request.deliveryContext ?? request.context,
      promptText: request.resolvedPrompt.text,
      count: request.parsed.count,
      maintenancePrompt: request.resolvedPrompt.maintenancePrompt,
    });
    return;
  }
  if (
    request.parsed.mode === "calendar" &&
    !request.confirm &&
    !(await hasSuccessfulCalendarLoop(state))
  ) {
    const timezone = resolveConfigTimezone({
      config: state.loadedConfig.raw,
      agentId: request.context.sessionTarget.agentId,
      routeTimezone: request.context.route.timezone,
      botTimezone: request.context.route.botTimezone,
      loopTimezone: request.loopTimezone,
    }).timezone;
    console.log(renderCalendarConfirmation({ request, timezone }));
    return;
  }
  await createRecurringLoop(state, request);
}

async function runCancelSubcommand(
  state: LoadedLoopControlState,
  args: string[],
  addressing: LoopCliAddressing,
) {
  if (addressing.newThread) {
    throw new Error("`--new-thread` only applies when creating a Slack loop.");
  }
  if (addressing.channel || addressing.target) {
    await cancelScopedLoops(state, args, addressing);
    return;
  }
  if (args[1] === "--all") {
    await cancelAllLoops(state);
    return;
  }
  const loopId = args[1]?.trim();
  if (!loopId) {
    throw new Error(
      `Usage: ${renderCliCommand("loops cancel <id>")} | ${renderCliCommand("loops cancel --all")}`,
    );
  }
  await cancelLoopById(state, loopId);
}

async function runStatusSubcommand(
  state: LoadedLoopControlState,
  addressing: LoopCliAddressing,
) {
  if (addressing.newThread) {
    throw new Error("`--new-thread` only applies when creating a Slack loop.");
  }
  if (addressing.channel || addressing.target) {
    await showScopedStatus(state, addressing);
    return;
  }
  await listLoops(state, "status");
}

export async function runLoopsCli(args: string[]) {
  const subcommand = args[0];
  if (!subcommand || subcommand === "--help" || subcommand === "-h" || subcommand === "help") {
    console.log(renderLoopsHelp());
    return;
  }

  const state = await loadLoopControlState();
  const addressing = parseAddressing(args);

  if (subcommand === "list") {
    await listLoops(state, "list");
    return;
  }

  if (subcommand === "status") {
    await runStatusSubcommand(state, addressing);
    return;
  }

  if (subcommand === "cancel") {
    await runCancelSubcommand(state, args, addressing);
    return;
  }

  if (subcommand === "create") {
    await createLoop(state, args, { explicitCreateSubcommand: true });
    return;
  }

  if (hasLoopContext(args)) {
    await createLoop(state, args);
    return;
  }

  throw new Error(renderLoopsHelp());
}
