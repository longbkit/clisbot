import { renderLoopStatusSchedule } from "../../agents/loops/loop-definition.ts";
import type { IntervalLoopStatus } from "../../agents/loops/loop-state.ts";
import { LOOP_APP_FLAG, LOOP_FORCE_FLAG, LOOP_START_FLAG } from "../../agents/loops/loop-command.ts";
import { renderCliCommand } from "./cli-name.ts";
import {
  getChannelPlugin,
  listChannelPlugins,
  renderChannelNamePlaceholder,
  renderSenderPrincipalExamples,
  renderSupportedChannelsNote,
} from "../../channels/catalog/registry.ts";
import { renderChildSurfaceFlag } from "../../channels/message/message-surface-helpers.ts";
import { collapseHomePath } from "../../infra/paths.ts";
import type { MessageChannel } from "../../channels/message/message-command.ts";
import type { LoopCliAddressing } from "./loop-cli-addressing.ts";

export function renderScopedCommand(base: string, addressing: LoopCliAddressing) {
  if (addressing.childSurface && !addressing.channel) {
    throw new Error("Child-surface loop commands require an explicit channel.");
  }
  const childSurfaceArg = addressing.childSurface
    ? `${renderChildSurfaceFlag({
      channel: addressing.channel as MessageChannel,
      kind: addressing.childSurface.kind,
    })} ${addressing.childSurface.providerId}`
    : null;
  const pluginArgs = addressing.channel
    ? getChannelPlugin(addressing.channel)?.loopCli?.renderScopedCommandArgs?.({ addressing }) ?? []
    : [];
  const suffix = [
    `--channel ${addressing.channel}`,
    addressing.target ? `--target ${addressing.target}` : null,
    childSurfaceArg,
    ...pluginArgs,
    addressing.botId ? `--bot ${addressing.botId}` : null,
  ]
    .filter(Boolean)
    .join(" ");
  return renderCliCommand(`${base} ${suffix}`.trim());
}

function renderChannelSpecificLoopHelp(
  channel: MessageChannel | undefined,
  command: "overview" | "create",
) {
  return channel ? getChannelPlugin(channel)?.renderLoopHelpLines?.({ command }) ?? [] : [];
}

function renderChannelTargetingHelp(
  channel: MessageChannel | undefined,
  _command: "overview" | "create",
) {
  return channel
    ? getChannelPlugin(channel)?.renderControlTargetingHelpLines?.() ?? []
    : [
      `  - use ${renderCliCommand(`loops --help --channel ${renderChannelNamePlaceholder()}`)} or ${renderCliCommand(`loops create --help --channel ${renderChannelNamePlaceholder()}`)} for channel-specific target syntax and loop extensions`,
      "  - channel child-surface flags are owned by each channel plugin",
    ];
}

function renderChannelLoopExamples(
  channel: MessageChannel | undefined,
  command: "overview" | "create",
) {
  return channel
    ? getChannelPlugin(channel)?.renderLoopExampleLines?.({ command }) ?? []
    : listChannelPlugins().flatMap((plugin) => plugin.renderLoopExampleLines?.({ command }) ?? []);
}

function renderLoopHelpExamples(channel: MessageChannel | undefined) {
  return [...new Set([
    ...renderChannelLoopExamples(channel, "overview"),
    ...renderChannelLoopExamples(channel, "create"),
  ])];
}

export function renderLoopsHelp(channel?: MessageChannel) {
  return [
    renderCliCommand("loops"),
    "",
    "Usage:",
    `  ${renderCliCommand("loops")}`,
    `  ${renderCliCommand("loops --help")}`,
    `  ${renderCliCommand("loops create --help")}`,
    `  ${renderCliCommand("loops list")}`,
    `  ${renderCliCommand("loops status")}`,
    `  ${renderCliCommand("loops cancel <id>")}`,
    `  ${renderCliCommand("loops cancel --all")}`,
    "",
    "Targets:",
    ...renderChannelTargetingHelp(channel, "overview"),
    `  - \`--sender <principal>\` is required when creating loops, using ${renderSenderPrincipalExamples(channel ? [channel] : undefined)}`,
    "  - optional creator display fields: `--sender-name <name>` and `--sender-handle <handle>`",
    "  - `--timezone <iana>` is a one-off wall-clock loop override and is frozen on the created loop record",
    `  - \`${LOOP_START_FLAG} <none|brief|full>\` controls scheduled loop-start notifications only; it does not control injected agent progress messages`,
    "  - `--progress <count>` overrides loop progress-message injection for agent replies; `0` disables progress messages, and omitting the flag inherits the normal clisbot prompt config",
    "",
    "Expressions:",
    "  - interval: `5m check CI` or `check CI every 5m`",
    `  - forced interval: \`1m ${LOOP_FORCE_FLAG} check CI\` or \`check CI every 1m ${LOOP_FORCE_FLAG}\``,
    "  - times: `3 check CI` or `check CI 3 times`",
    "  - calendar: `every day at 07:00 check CI`, `every weekday at 07:00 standup`, or `every mon at 09:00 review queue`",
    "  - omit the prompt to load `LOOP.md` from the target workspace",
    "",
    "Examples:",
    ...renderLoopHelpExamples(channel),
    ...renderChannelSpecificLoopHelp(channel, "overview"),
    "Behavior:",
    "  - bare `list` renders the global persisted loop inventory; scoped `list --channel ... --target ...` renders one routed session",
    "  - bare `status` is global; scoped `status --channel ... --target ...` matches `/loop status` for one routed session",
    "  - `create` and bare scoped syntax reuse the same loop parser as channel `/loop`",
    "  - CLI loop creation fails without `--sender` so scheduled prompts can preserve creator identity",
    "  - the first wall-clock loop returns `confirmation_required` and does not persist until rerun with `--confirm`",
    "  - recurring interval loops and confirmed wall-clock loops are persisted immediately and picked up by the runtime when it is running",
    "  - loop-created agent prompts inherit the normal clisbot prompt config unless `--progress <count>` overrides that loop",
    "  - if runtime is stopped, recurring loops activate on the next `clisbot start`",
    "  - global `cancel --all` clears the whole app; scoped `cancel --all` clears one routed session",
    `  - \`cancel --all ${LOOP_APP_FLAG}\` is accepted only with a scoped session target, matching \`/loop cancel --all ${LOOP_APP_FLAG}\``,
    "  - one-shot count loops run synchronously in the CLI; durable one-shot prompts use `clisbot queues`",
    "  - wall-clock loop timezone resolves from `--timezone`, route/topic, agent, bot, app timezone, then legacy defaults, then host",
    "  - calendar loops freeze the resolved effective timezone at creation time; if timing looks wrong, run `clisbot timezone get` first and inspect agent or route timezone only for scoped overrides",
  ].join("\n");
}

export function renderLoopsCreateHelp(channel?: MessageChannel) {
  const channelName = renderChannelNamePlaceholder();
  return [
    renderCliCommand("loops create"),
    "",
    "Usage:",
    `  ${renderCliCommand(`loops create --channel ${channelName} --target <surface> --sender <principal> <expression>`)}`,
    `  ${renderCliCommand(`loops --channel ${channelName} --target <surface> --sender <principal> <expression>`)}`,
    "",
    "Required:",
    `  - \`--channel ${channelName}\` and \`--target <surface>\` select the routed session`,
    `  - \`--sender <principal>\` records the human creator, for example ${renderSenderPrincipalExamples(channel ? [channel] : undefined)}`,
    `  - ${renderSupportedChannelsNote()}`,
    "",
    "Optional:",
    "  - `--sender-name <name>` stores a readable creator name for scheduled prompt context",
    "  - `--sender-handle <handle>` stores a creator handle without `@`",
    ...renderChannelTargetingHelp(channel, "create"),
    "  - `--timezone <iana>` freezes a one-off wall-clock timezone on the loop record",
    "  - `--confirm` persists the first wall-clock loop after reviewing the confirmation output",
    `  - advanced: \`${LOOP_START_FLAG} <none|brief|full>\` overrides the default scheduled loop-start notification behavior for that recurring loop`,
    "  - advanced: `--progress <count>` overrides loop agent progress-message injection; `0` disables progress messages, and omitting the flag inherits the normal clisbot prompt config",
    "",
    "Examples:",
    ...renderChannelLoopExamples(channel, "create"),
    ...renderChannelSpecificLoopHelp(channel, "create"),
    "",
    "Behavior:",
    "  - create without `--sender` fails by design",
    "  - the `--sender` platform must match `--channel`",
    "  - recurring CLI-created loops persist creator metadata into the session store",
    "  - CLI-created loop prompts inherit the normal clisbot prompt config unless `--progress <count>` is provided",
  ].join("\n");
}

export function renderLoopInventory(params: {
  commandLabel: "list" | "status";
  configPath: string;
  sessionStorePath: string;
  loops: IntervalLoopStatus[];
}) {
  const lines = [
    renderCliCommand(`loops ${params.commandLabel}`),
    "",
    `config: ${collapseHomePath(params.configPath)}`,
    `sessionStore: ${collapseHomePath(params.sessionStorePath)}`,
    `activeLoops.global: \`${params.loops.length}\``,
  ];

  if (params.loops.length === 0) {
    lines.push("", "No active loops.");
    return lines.join("\n");
  }

  lines.push("");
  for (const loop of params.loops) {
    lines.push(
      `- id: \`${loop.id}\` agent: \`${loop.agentId}\` session: \`${loop.sessionKey}\` ${renderLoopStatusSchedule(loop)} remaining: \`${loop.remainingRuns}\` nextRunAt: \`${new Date(loop.nextRunAt).toISOString()}\` prompt: \`${loop.promptSummary}\`${loop.kind !== "calendar" && loop.force ? " force" : ""}`,
    );
  }
  return lines.join("\n");
}

export function renderScopedLoopStatus(params: {
  commandLabel: string;
  configPath: string;
  sessionStorePath: string;
  sessionKey: string;
  sessionLoops: IntervalLoopStatus[];
  globalLoopCount: number;
}) {
  const lines = [
    params.commandLabel,
    "",
    `config: ${collapseHomePath(params.configPath)}`,
    `sessionStore: ${collapseHomePath(params.sessionStorePath)}`,
    `sessionKey: \`${params.sessionKey}\``,
  ];

  if (params.sessionLoops.length === 0) {
    lines.push(
      "No active loops for this session.",
      `activeLoops.global: \`${params.globalLoopCount}\``,
    );
    return lines.join("\n");
  }

  lines.push(
    `activeLoops.session: \`${params.sessionLoops.length}\``,
    `activeLoops.global: \`${params.globalLoopCount}\``,
    "",
  );
  for (const loop of params.sessionLoops) {
    lines.push(
      `- id: \`${loop.id}\` ${renderLoopStatusSchedule(loop)} remaining: \`${loop.remainingRuns}\` nextRunAt: \`${new Date(loop.nextRunAt).toISOString()}\` prompt: \`${loop.promptSummary}\`${loop.kind !== "calendar" && loop.force ? " force" : ""}`,
    );
  }
  return lines.join("\n");
}

export function renderLoopStoreSummary(sessionStorePath: string, activeLoopCount: number) {
  return [
    `activeLoops.global: \`${activeLoopCount}\``,
    `sessionStore: ${collapseHomePath(sessionStorePath)}`,
  ];
}
