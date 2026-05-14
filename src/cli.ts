import { REPO_HELP_HINT, USER_GUIDE_DOC_PATH } from "./control/commands/startup-bootstrap.ts";
import {
  DEFAULT_CLISBOT_CLI_NAME,
  getRenderedCliName,
  renderCliCommand,
} from "./control/commands/cli-name.ts";
import {
  renderBootstrapExampleCommands,
  renderBootstrapUsageLines,
} from "./channels/catalog/registry.ts";
import {
  executeCommandTree,
  renderCommandTreeCommandLines,
  renderCommandTreeUsageLines,
  type CommandTreeSpec,
} from "./control/commands/command-tree.ts";
import { renderChannelNamePlaceholder } from "./channels/catalog/registry.ts";
import { collapseHomePath, getDefaultConfigPath } from "./infra/paths.ts";
import { getClisbotVersion } from "./version.ts";

export type ParsedCliCommand =
  | { name: "help" }
  | { name: "version" }
  | { name: "start"; args: string[] }
  | { name: "restart" }
  | { name: "stop"; hard: boolean }
  | { name: "status" }
  | { name: "logs"; lines: number }
  | { name: "update"; args: string[] }
  | { name: "timezone"; args: string[] }
  | { name: "bots"; args: string[] }
  | { name: "routes"; args: string[] }
  | { name: "channels"; args: string[] }
  | { name: "accounts"; args: string[] }
  | { name: "loops"; args: string[] }
  | { name: "queues"; args: string[] }
  | { name: "message"; args: string[] }
  | { name: "agents"; args: string[] }
  | { name: "auth"; args: string[] }
  | { name: "runner"; args: string[] }
  | { name: "pairing"; args: string[] }
  | { name: "init"; args: string[] }
  | { name: "serve-foreground" }
  | { name: "serve-monitor" };

const ROOT_COMMAND_TREE: CommandTreeSpec<ParsedCliCommand> = {
  onEmpty: () => ({ name: "help" }),
  nodes: [
    {
      name: "help",
      aliases: ["--help", "-h"],
      hiddenInHelp: true,
      handler: () => ({ name: "help" }),
    },
    {
      name: "version",
      aliases: ["--version", "-v"],
      summary: "Show the installed clisbot version.",
      usage: ["version"],
      helpLines: ["  --version, -v      Show the installed clisbot version."],
      handler: () => ({ name: "version" }),
    },
    {
      name: "start",
      summary: "Seed __CONFIG_PATH__ if missing, apply explicit bot bootstrap intent, and start clisbot in the background.",
      usage: ["start [--cli <codex|claude|gemini>] [--bot-type <personal|team>] [--persist]"],
      helpLines: [
        "                     See `start --help` for bootstrap-focused flags and examples.",
      ],
      passthroughArgs: true,
      handler: ({ passthroughArgs }) => ({ name: "start", args: [...passthroughArgs] }),
    },
    {
      name: "restart",
      summary: "Stop the running clisbot process, then start it again.",
      usage: ["restart"],
      handler: () => ({ name: "restart" }),
    },
    {
      name: "stop",
      summary: "Stop the running clisbot process.",
      usage: ["stop [--hard]"],
      helpLines: [
        "  stop --hard        Stop clisbot and kill all tmux sessions on the configured clisbot socket.",
      ],
      options: [{ key: "hard", flags: ["--hard"], kind: "flag" }],
      handler: ({ options }) => ({ name: "stop", hard: Boolean(options.hard) }),
    },
    {
      name: "status",
      summary: "Show runtime process, config, log, tmux socket status, and recent runner sessions.",
      usage: ["status"],
      handler: () => ({ name: "status" }),
    },
    {
      name: "logs",
      summary: "Print the most recent clisbot log lines.",
      usage: ["logs [--lines N]"],
      options: [{ key: "lines", flags: ["--lines", "-n"] }],
      handler: ({ options }) => ({ name: "logs", lines: normalizeLineCount(options.lines) }),
    },
    {
      name: "update",
      summary: "Print the update guide and release/migration doc links.",
      usage: ["update --help"],
      helpLines: [
        "                     See `update --help` before asking an agent to update clisbot.",
      ],
      passthroughArgs: true,
      handler: ({ passthroughArgs }) => ({ name: "update", args: [...passthroughArgs] }),
    },
    {
      name: "timezone",
      summary: "Manage the app-wide wall-clock timezone used by schedules and loops.",
      usage: ["timezone <get|set|clear|doctor>"],
      helpLines: ["                     See `timezone --help` for override guidance."],
      passthroughArgs: true,
      handler: ({ passthroughArgs }) => ({ name: "timezone", args: [...passthroughArgs] }),
    },
    {
      name: "bots",
      summary: "Manage provider bot identities, credentials, and bot-level fallback settings.",
      usage: ["bots <subcommand>"],
      helpLines: [
        "                     list|add|get|enable|disable|remove|get-default|set-default",
        "                     get-agent|set-agent|clear-agent",
        "                     get-credentials-source|set-credentials",
        "                     get-dm-policy|set-dm-policy",
        "                     See `bots --help` for examples and credential behavior.",
      ],
      passthroughArgs: true,
      handler: ({ passthroughArgs }) => ({ name: "bots", args: [...passthroughArgs] }),
    },
    {
      name: "routes",
      summary: "Manage admitted inbound surfaces under each bot.",
      usage: ["routes <subcommand>"],
      helpLines: [
        "                     list|add|get|enable|disable|remove",
        "                     get-agent|set-agent|clear-agent",
        "                     get-policy|set-policy",
        "                     get-require-mention|set-require-mention",
        "                     get-allow-bots|set-allow-bots",
        "                     add/remove allow-user|block-user",
        "                     get/set follow-up mode and ttl",
        "                     get/set/clear response mode and additional-message mode",
        "                     See `routes --help` for route ids and examples.",
      ],
      passthroughArgs: true,
      handler: ({ passthroughArgs }) => ({ name: "routes", args: [...passthroughArgs] }),
    },
    {
      name: "channels",
      hiddenInHelp: true,
      passthroughArgs: true,
      handler: ({ passthroughArgs }) => ({ name: "channels", args: [...passthroughArgs] }),
    },
    {
      name: "accounts",
      hiddenInHelp: true,
      passthroughArgs: true,
      handler: ({ passthroughArgs }) => ({ name: "accounts", args: [...passthroughArgs] }),
    },
    {
      name: "loops",
      summary: "Create, inspect, or cancel managed loops with routed session context or app-wide inventory views.",
      usage: ["loops <subcommand>"],
      helpLines: [
        "                     list|status",
        `                     create --channel ${renderChannelNamePlaceholder()} --target <route> [channel child-surface flags] <expression>`,
        "                     cancel <id>|--all",
        "                     scoped list/status/cancel also accept --channel/--target plus channel child-surface flags",
        "                     `--target` selects the routed surface; child-surface flags are channel-specific",
        "                     Use __LOOPS_CHANNEL_HELP__ for channel-specific loop extensions.",
        "                     See `loops --help` for slash-compatible expressions and examples.",
      ],
      passthroughArgs: true,
      handler: ({ passthroughArgs }) => ({ name: "loops", args: [...passthroughArgs] }),
    },
    {
      name: "queues",
      summary: "Create, inspect, or clear durable queued prompts without interrupting running work.",
      usage: ["queues <subcommand>"],
      helpLines: [
        "                     list|status|create|clear",
        `                     create --channel ${renderChannelNamePlaceholder()} --target <route> --sender <principal> <prompt>`,
        "                     list shows pending only; status includes pending and running.",
        "                     See `queues --help` for scoped queue examples.",
      ],
      passthroughArgs: true,
      handler: ({ passthroughArgs }) => ({ name: "queues", args: [...passthroughArgs] }),
    },
    {
      name: "message",
      summary: "Run provider message actions such as send, react, read, edit, delete, and pins.",
      usage: ["message <subcommand>"],
      helpLines: ["                     See `message --help` for channel-specific syntax."],
      passthroughArgs: true,
      handler: ({ passthroughArgs }) => ({ name: "message", args: [...passthroughArgs] }),
    },
    {
      name: "agents",
      summary: "Manage configured agents, workspaces, bootstrap files, and per-agent mode overrides.",
      usage: ["agents <subcommand>"],
      helpLines: [
        "                     See `agents --help` for focused add/bootstrap help.",
      ],
      passthroughArgs: true,
      handler: ({ passthroughArgs }) => ({ name: "agents", args: [...passthroughArgs] }),
    },
    {
      name: "auth",
      summary: "Manage app and agent auth roles, principals, and permissions in config. See `auth --help`.",
      usage: ["auth <subcommand>"],
      passthroughArgs: true,
      handler: ({ passthroughArgs }) => ({ name: "auth", args: [...passthroughArgs] }),
    },
    {
      name: "runner",
      summary: "Inspect tmux-backed runner sessions and validate runner smoke contracts.",
      usage: ["runner <subcommand>"],
      helpLines: [
        "                     list|inspect <session-name>|inspect --latest|inspect --index <n>|watch <session-name>|watch --latest|watch --next|watch --index <n>|smoke ...",
        "                     See `runner --help` for operator debug and smoke details.",
      ],
      passthroughArgs: true,
      handler: ({ passthroughArgs }) => ({ name: "runner", args: [...passthroughArgs] }),
    },
    {
      name: "watch",
      hiddenInCommandList: true,
      usage: ["watch <session-name>|--latest|--index <n>"],
      passthroughArgs: true,
      handler: ({ passthroughArgs }) => ({ name: "runner", args: ["watch", ...passthroughArgs] }),
    },
    {
      name: "inspect",
      hiddenInCommandList: true,
      usage: ["inspect <session-name>|--latest|--index <n>"],
      passthroughArgs: true,
      handler: ({ passthroughArgs }) => ({
        name: "runner",
        args: ["inspect", ...passthroughArgs],
      }),
    },
    {
      name: "pairing",
      summary: "Run the pairing control CLI. See `pairing --help`.",
      usage: ["pairing <subcommand>"],
      passthroughArgs: true,
      handler: ({ passthroughArgs }) => ({ name: "pairing", args: [...passthroughArgs] }),
    },
    {
      name: "init",
      summary: "Seed __CONFIG_PATH__ and optionally create the first agent without starting clisbot.",
      usage: ["init [--cli <codex|claude|gemini>] [--bot-type <personal|team>] [--persist]"],
      helpLines: [
        "                     See `init --help` for bootstrap-focused flags and examples.",
      ],
      passthroughArgs: true,
      handler: ({ passthroughArgs }) => ({ name: "init", args: [...passthroughArgs] }),
    },
    {
      name: "serve-foreground",
      hiddenInHelp: true,
      handler: () => ({ name: "serve-foreground" }),
    },
    {
      name: "serve-monitor",
      hiddenInHelp: true,
      handler: () => ({ name: "serve-monitor" }),
    },
  ],
};

export function parseCliArgs(argv: string[]): ParsedCliCommand {
  return executeCommandTree(argv.slice(2), ROOT_COMMAND_TREE);
}

export function renderCliHelp() {
  const configPath = collapseHomePath(getDefaultConfigPath());
  const cliName = getRenderedCliName();
  const lines = [
    `${cliName} v${getClisbotVersion()}`,
    "",
    "Platform support:",
    "  Linux/macOS  Supported.",
    "  Windows      Native Windows is not supported yet. Use WSL2.",
    "",
    "Fastest start:",
    "  1. Choose the channels you want to bootstrap explicitly.",
    "  2. Run one of these commands:",
    ...renderBootstrapExampleCommands("start").map((command) => `     ${command}`),
    `  3. Use ${renderCliCommand("status", { inline: true })} to see runtime state and the most recent runner sessions.`,
    `     Use ${renderCliCommand("watch --latest", { inline: true })} when you want to jump straight into the newest live pane.`,
    "",
    "Bot types:",
    "  personal  One human gets one dedicated long-lived assistant workspace and session path.",
    "  team      One shared channel or group routes into one shared assistant workspace and session path.",
    "",
    "Bootstrap files:",
    "  `--bot-type` seeds workspace guidance files for a fresh agent. It is optional when you already have a workspace.",
    "  Canonical workspace instructions live in `AGENTS.md`.",
    "  Claude and Gemini bootstraps also add `CLAUDE.md` or `GEMINI.md` as symlinks to `AGENTS.md` for CLI discovery.",
    "",
    "Credential input rules:",
    "  Pass ENV_NAME or ${ENV_NAME} to keep the selected bot env-backed.",
    "  Pass a raw or shell-expanded token value to use credentialType=mem for the current runtime only.",
    "  Raw token input on `start` is only for cold start unless you also pass --persist.",
    "  Fresh bootstrap only enables channels named by flags; ambient env vars alone do not auto-enable extra channels.",
    "",
    "Working hints:",
    `  Add extra workspaces with ${renderCliCommand("agents add <id> --cli <codex|claude|gemini>", { inline: true })}, then point traffic with ${renderCliCommand("bots set-agent ...", { inline: true })} or ${renderCliCommand("routes set-agent ...", { inline: true })}.`,
    `  For routed shared surfaces, the usual flow is ${renderCliCommand("routes add ...", { inline: true })} -> ${renderCliCommand("routes set-agent ...", { inline: true })} -> optional follow-up or allowlist tuning.`,
    `  For fast runner debugging, start with ${renderCliCommand("runner list", { inline: true })} and ${renderCliCommand("watch --latest", { inline: true })}.`,
    "",
    "Usage:",
    ...renderRootUsageLines(),
    ...(cliName === DEFAULT_CLISBOT_CLI_NAME ? ["  clis <same-command>"] : []),
    `  ${renderCliCommand("--help")}`,
    "",
    "Commands:",
    ...renderRootCommandLines(configPath),
    `  runner shortcuts   ${renderCliCommand("watch --latest", { inline: true })} and ${renderCliCommand("inspect --latest", { inline: true })} are shorthand for runner debug commands.`,
    "  --help             Show this help text.",
    "",
    ...(cliName === DEFAULT_CLISBOT_CLI_NAME
      ? [
          "Package usage:",
          "  npx clisbot start",
          "  npm install -g clisbot && clisbot start",
          "  npm install -g clisbot && clis start",
          "",
        ]
      : [
          "Dev usage:",
          `  ${renderCliCommand("start")}`,
          `  ${renderCliCommand("status")}`,
          "  bun run start",
          "",
        ]),
    "More info:",
    `  Docs: ${USER_GUIDE_DOC_PATH}`,
    `  ${REPO_HELP_HINT}`,
  ];
  return lines.join("\n");
}

function renderRootUsageLines() {
  const usageLines = renderCommandTreeUsageLines(ROOT_COMMAND_TREE, getRenderedCliName());
  const lines: string[] = [];
  for (const line of usageLines) {
    lines.push(line);
    if (line.includes("start [--cli")) {
      lines.push(...renderBootstrapUsageLines("               "));
    }
    if (line.includes("init [--cli")) {
      lines.push(...renderBootstrapUsageLines("              "));
    }
  }
  return lines;
}

function renderRootCommandLines(configPath: string) {
  return renderCommandTreeCommandLines(ROOT_COMMAND_TREE, (line) =>
    line
      .replaceAll("__CONFIG_PATH__", configPath)
      .replace("`start --help`", renderCliCommand("start --help", { inline: true }))
      .replace("`update --help`", renderCliCommand("update --help", { inline: true }))
      .replace("`timezone --help`", renderCliCommand("timezone --help", { inline: true }))
      .replace("`bots --help`", renderCliCommand("bots --help", { inline: true }))
      .replace("`routes --help`", renderCliCommand("routes --help", { inline: true }))
      .replace("`loops --help`", renderCliCommand("loops --help", { inline: true }))
      .replace(
        "__LOOPS_CHANNEL_HELP__",
        renderCliCommand(`loops --help --channel ${renderChannelNamePlaceholder()}`, {
          inline: true,
        }),
      )
      .replace("`queues --help`", renderCliCommand("queues --help", { inline: true }))
      .replace("`message --help`", renderCliCommand("message --help", { inline: true }))
      .replace("`agents --help`", renderCliCommand("agents --help", { inline: true }))
      .replace("`auth --help`", renderCliCommand("auth --help", { inline: true }))
      .replace("`runner --help`", renderCliCommand("runner --help", { inline: true }))
      .replace("`pairing --help`", renderCliCommand("pairing --help", { inline: true }))
      .replace("`init --help`", renderCliCommand("init --help", { inline: true })),
  );
}

function normalizeLineCount(value: unknown) {
  if (value === undefined) {
    return 200;
  }
  const rawValue = String(value);
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid line count: ${rawValue}`);
  }
  return parsed;
}
