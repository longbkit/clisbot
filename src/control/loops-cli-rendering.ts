import { renderLoopStatusSchedule } from "../agents/loop-control-shared.ts";
import type { IntervalLoopStatus } from "../agents/loop-state.ts";
import { LOOP_APP_FLAG, LOOP_FORCE_FLAG } from "../agents/loop-command.ts";
import { renderSlackTargetSyntax } from "../config/route-contract.ts";
import { renderCliCommand } from "../shared/cli-name.ts";
import { collapseHomePath } from "../shared/paths.ts";
import {
  type LoopCliAddressing,
  resolveLoopSubtargetId,
} from "./loop-cli-addressing.ts";

export function renderScopedCommand(base: string, addressing: LoopCliAddressing) {
  const subtargetId = resolveLoopSubtargetId(addressing);
  const subtargetFlag = addressing.channel === "telegram" ? "--topic-id" : "--thread-id";
  const suffix = [
    `--channel ${addressing.channel}`,
    addressing.target ? `--target ${addressing.target}` : null,
    subtargetId ? `${subtargetFlag} ${subtargetId}` : null,
    addressing.newThread ? "--new-thread" : null,
    addressing.botId ? `--bot ${addressing.botId}` : null,
  ]
    .filter(Boolean)
    .join(" ");
  return renderCliCommand(`${base} ${suffix}`.trim());
}

export function renderLoopsHelp() {
  return [
    renderCliCommand("loops"),
    "",
    "Usage:",
    `  ${renderCliCommand("loops")}`,
    `  ${renderCliCommand("loops --help")}`,
    `  ${renderCliCommand("loops create --help")}`,
    `  ${renderCliCommand("loops list")}`,
    `  ${renderCliCommand("loops status")}`,
    `  ${renderCliCommand("loops status --channel slack --target group:C1234567890 --thread-id 1712345678.123456")}`,
    `  ${renderCliCommand("loops create --channel slack --target group:C1234567890 --thread-id 1712345678.123456 --sender slack:U1234567890 every day at 07:00 check CI")}`,
    `  ${renderCliCommand("loops create --channel slack --target group:C1234567890 --thread-id 1712345678.123456 --sender slack:U1234567890 every day at 07:00 check CI --confirm")}`,
    `  ${renderCliCommand("loops create --channel telegram --target -1001234567890 --sender telegram:1276408333 --timezone America/Los_Angeles every day at 07:00 check tickets")}`,
    `  ${renderCliCommand("loops create --channel slack --target group:C1234567890 --new-thread --sender slack:U1234567890 every day at 07:00 check CI")}`,
    `  ${renderCliCommand("loops --channel slack --target group:C1234567890 --thread-id 1712345678.123456 --sender slack:U1234567890 5m check CI")}`,
    `  ${renderCliCommand("loops create --channel telegram --target -1001234567890 --topic-id 42 --sender telegram:1276408333 every weekday at 07:00 standup")}`,
    `  ${renderCliCommand("loops --channel slack --target group:C1234567890 --thread-id 1712345678.123456 --sender slack:U1234567890 3 review backlog")}`,
    `  ${renderCliCommand("loops cancel <id>")}`,
    `  ${renderCliCommand("loops cancel --all")}`,
    `  ${renderCliCommand("loops cancel --channel slack --target group:C1234567890 --thread-id 1712345678.123456 --all")}`,
    `  ${renderCliCommand("loops cancel --channel slack --target group:C1234567890 --thread-id 1712345678.123456")}`,
    `  ${renderCliCommand(`loops cancel --channel slack --target group:C1234567890 --thread-id 1712345678.123456 --all ${LOOP_APP_FLAG}`)}`,
    "",
    "Targets:",
    `  - Slack \`--target\` accepts ${renderSlackTargetSyntax()}`,
    "  - Telegram `--target` is the numeric chat id",
    "  - use `--thread-id` for an existing Slack thread ts",
    "  - use `--topic-id` for a Telegram topic id",
    "  - omitting the sub-surface flag targets the parent Slack channel/group/DM or the parent Telegram chat",
    "  - `--new-thread` is Slack-only and creates a fresh thread anchor before the loop starts",
    "  - `--sender <principal>` is required when creating loops, using `slack:<user-id>` or `telegram:<user-id>`",
    "  - optional creator display fields: `--sender-name <name>` and `--sender-handle <handle>`",
    "  - `--timezone <iana>` is a one-off wall-clock loop override and is frozen on the created loop record",
    "  - in Telegram forum groups, omitting `--topic-id` targets the parent chat surface; sends then follow Telegram's normal no-`message_thread_id` behavior, which is the General topic when that forum has one",
    "",
    "Expressions:",
    "  - interval: `5m check CI` or `check CI every 5m`",
    `  - forced interval: \`1m ${LOOP_FORCE_FLAG} check CI\` or \`check CI every 1m ${LOOP_FORCE_FLAG}\``,
    "  - times: `3 check CI` or `check CI 3 times`",
    "  - calendar: `every day at 07:00 check CI`, `every weekday at 07:00 standup`, or `every mon at 09:00 review queue`",
    "  - omit the prompt to load `LOOP.md` from the target workspace",
    "",
    "Examples:",
    `  ${renderCliCommand("loops status --channel slack --target group:C1234567890 --thread-id 1712345678.123456")}`,
    `  ${renderCliCommand("loops --channel telegram --target -1001234567890 --topic-id 42 --sender telegram:1276408333 5m")}`,
    `  ${renderCliCommand("loops --channel slack --target dm:U1234567890 --new-thread --sender slack:U1234567890 every day at 09:00 check inbox")}`,
    `  ${renderCliCommand("loops cancel --channel slack --target group:C1234567890 --thread-id 1712345678.123456 abc123")}`,
    "Behavior:",
    "  - `list` always renders the global persisted loop inventory",
    "  - bare `status` is global; scoped `status --channel ... --target ...` matches `/loop status` for one routed session",
    "  - `create` and bare scoped syntax reuse the same loop parser as channel `/loop`",
    "  - CLI loop creation fails without `--sender` so scheduled prompts can preserve creator identity",
    "  - the first wall-clock loop returns `confirmation_required` and does not persist until rerun with `--confirm`",
    "  - recurring interval loops and confirmed wall-clock loops are persisted immediately and picked up by the runtime when it is running",
    "  - if runtime is stopped, recurring loops activate on the next `clisbot start`",
    "  - global `cancel --all` clears the whole app; scoped `cancel --all` clears one routed session",
    "  - `cancel --all --app` is accepted only with a scoped session target, matching `/loop cancel --all --app`",
    "  - one-shot count loops run synchronously in the CLI because the top-level operator process has no shared queue IPC today",
    "  - wall-clock loop timezone resolves from `--timezone`, route/topic, agent, bot, app timezone, then legacy defaults, then host",
    "  - calendar loops freeze the resolved effective timezone at creation time; if timing looks wrong, run `clisbot timezone get` first and inspect agent or route timezone only for scoped overrides",
  ].join("\n");
}

export function renderLoopsCreateHelp() {
  return [
    renderCliCommand("loops create"),
    "",
    "Usage:",
    `  ${renderCliCommand("loops create --channel <slack|telegram> --target <surface> --sender <principal> <expression>")}`,
    `  ${renderCliCommand("loops --channel <slack|telegram> --target <surface> --sender <principal> <expression>")}`,
    "",
    "Required:",
    "  - `--channel <slack|telegram>` and `--target <surface>` select the routed session",
    "  - `--sender <principal>` records the human creator, for example `slack:U1234567890` or `telegram:1276408333`",
    "",
    "Optional:",
    "  - `--sender-name <name>` stores a readable creator name for scheduled prompt context",
    "  - `--sender-handle <handle>` stores a creator handle without `@`",
    "  - `--thread-id <ts>` targets an existing Slack thread",
    "  - `--topic-id <id>` targets a Telegram topic",
    "  - `--new-thread` creates a Slack thread anchor before persisting the loop",
    "  - `--timezone <iana>` freezes a one-off wall-clock timezone on the loop record",
    "  - `--confirm` persists the first wall-clock loop after reviewing the confirmation output",
    "",
    "Examples:",
    `  ${renderCliCommand("loops create --channel slack --target group:C1234567890 --thread-id 1712345678.123456 --sender slack:U1234567890 every day at 07:00 check CI")}`,
    `  ${renderCliCommand("loops create --channel telegram --target -1001234567890 --topic-id 42 --sender telegram:1276408333 5m check CI")}`,
    `  ${renderCliCommand("loops create --channel slack --target dm:U1234567890 --new-thread --sender slack:U1234567890 every day at 09:00 check inbox")}`,
    "",
    "Behavior:",
    "  - create without `--sender` fails by design",
    "  - the `--sender` platform must match `--channel`",
    "  - recurring CLI-created loops persist creator metadata into the session store",
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
