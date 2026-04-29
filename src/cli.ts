import { REPO_HELP_HINT, USER_GUIDE_DOC_PATH } from "./control/startup-bootstrap.ts";
import {
  DEFAULT_CLISBOT_CLI_NAME,
  getRenderedCliName,
  renderCliCommand,
} from "./shared/cli-name.ts";
import { collapseHomePath, getDefaultConfigPath } from "./shared/paths.ts";
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
  | { name: "message"; args: string[] }
  | { name: "agents"; args: string[] }
  | { name: "auth"; args: string[] }
  | { name: "runner"; args: string[] }
  | { name: "pairing"; args: string[] }
  | { name: "init"; args: string[] }
  | { name: "serve-foreground" }
  | { name: "serve-monitor" };

export function parseCliArgs(argv: string[]): ParsedCliCommand {
  const args = argv.slice(2);
  const command = args[0];

  if (!command || command === "help" || command === "--help" || command === "-h") {
    return { name: "help" };
  }

  if (command === "version" || command === "--version" || command === "-v") {
    return { name: "version" };
  }

  if (command === "start") {
    return {
      name: "start",
      args: args.slice(1),
    };
  }

  if (command === "restart") {
    return { name: "restart" };
  }

  if (command === "stop") {
    return {
      name: "stop",
      hard: args.includes("--hard"),
    };
  }

  if (command === "status") {
    return { name: "status" };
  }

  if (command === "logs") {
    return {
      name: "logs",
      lines: parseLineCount(args.slice(1)),
    };
  }

  if (command === "update") {
    return {
      name: "update",
      args: args.slice(1),
    };
  }

  if (command === "timezone") {
    return {
      name: "timezone",
      args: args.slice(1),
    };
  }

  if (command === "bots") {
    return {
      name: "bots",
      args: args.slice(1),
    };
  }

  if (command === "routes") {
    return {
      name: "routes",
      args: args.slice(1),
    };
  }

  if (command === "channels") {
    return {
      name: "channels",
      args: args.slice(1),
    };
  }

  if (command === "accounts") {
    return {
      name: "accounts",
      args: args.slice(1),
    };
  }

  if (command === "loops") {
    return {
      name: "loops",
      args: args.slice(1),
    };
  }

  if (command === "message") {
    return {
      name: "message",
      args: args.slice(1),
    };
  }

  if (command === "agents") {
    return {
      name: "agents",
      args: args.slice(1),
    };
  }

  if (command === "auth") {
    return {
      name: "auth",
      args: args.slice(1),
    };
  }

  if (command === "runner") {
    return {
      name: "runner",
      args: args.slice(1),
    };
  }

  if (command === "pairing") {
    return {
      name: "pairing",
      args: args.slice(1),
    };
  }

  if (command === "init") {
    return {
      name: "init",
      args: args.slice(1),
    };
  }

  if (command === "serve-foreground") {
    return { name: "serve-foreground" };
  }

  if (command === "serve-monitor") {
    return { name: "serve-monitor" };
  }

  throw new Error(`Unknown command: ${command}`);
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
    `     ${renderCliCommand("start --cli codex --bot-type personal --telegram-bot-token TELEGRAM_BOT_TOKEN")}`,
    `     ${renderCliCommand("start --cli codex --bot-type personal --telegram-bot-token \"$TELEGRAM_BOT_TOKEN\" --persist")}`,
    `     ${renderCliCommand("start --cli codex --bot-type team --slack-app-token SLACK_APP_TOKEN --slack-bot-token SLACK_BOT_TOKEN")}`,
    `  3. Use ${renderCliCommand("status", { inline: true })} to see runtime state and the most recent runner sessions.`,
    `     Use ${renderCliCommand("runner watch --latest", { inline: true })} when you want to jump straight into the newest live pane.`,
    "",
    "Bot types:",
    "  personal  One human gets one dedicated long-lived assistant workspace and session path.",
    "  team      One shared channel or group routes into one shared assistant workspace and session path.",
    "",
    "Credential input rules:",
    "  Pass ENV_NAME or ${ENV_NAME} to keep the selected bot env-backed.",
    "  Pass a raw or shell-expanded token value to use credentialType=mem for the current runtime only.",
    "  Raw token input on `start` is only for cold start unless you also pass --persist.",
    "  Fresh bootstrap only enables channels named by flags; ambient env vars alone do not auto-enable extra channels.",
    "",
    "Working hints:",
    `  Add extra workspaces with ${renderCliCommand("agents add <id> --cli <codex|claude|gemini>", { inline: true })}, then point traffic with ${renderCliCommand("bots set-agent ...", { inline: true })} or ${renderCliCommand("routes set-agent ...", { inline: true })}.`,
    `  For shared Slack/Telegram surfaces, the usual flow is ${renderCliCommand("routes add ...", { inline: true })} -> ${renderCliCommand("routes set-agent ...", { inline: true })} -> optional follow-up or allowlist tuning.`,
    `  For fast runner debugging, start with ${renderCliCommand("runner list", { inline: true })} and ${renderCliCommand("runner watch --latest", { inline: true })}.`,
    "",
    "Usage:",
    `  ${renderCliCommand("start [--cli <codex|claude|gemini>] [--bot-type <personal|team>] [--persist]")}`,
    "               [--slack-account <id> --slack-app-token <ENV_NAME|${ENV_NAME}|literal> --slack-bot-token <ENV_NAME|${ENV_NAME}|literal>]...",
    "               [--telegram-account <id> --telegram-bot-token <ENV_NAME|${ENV_NAME}|literal>]...",
    `  ${renderCliCommand("restart")}`,
    `  ${renderCliCommand("stop [--hard]")}`,
    `  ${renderCliCommand("status")}`,
    `  ${renderCliCommand("version")}`,
    `  ${renderCliCommand("logs [--lines N]")}`,
    `  ${renderCliCommand("update --help")}`,
    `  ${renderCliCommand("timezone <get|set|clear|doctor>")}`,
    `  ${renderCliCommand("bots <subcommand>")}`,
    `  ${renderCliCommand("routes <subcommand>")}`,
    `  ${renderCliCommand("loops <subcommand>")}`,
    `  ${renderCliCommand("message <subcommand>")}`,
    `  ${renderCliCommand("agents <subcommand>")}`,
    `  ${renderCliCommand("auth <subcommand>")}`,
    `  ${renderCliCommand("runner <subcommand>")}`,
    `  ${renderCliCommand("pairing <subcommand>")}`,
    `  ${renderCliCommand("init [--cli <codex|claude|gemini>] [--bot-type <personal|team>] [--persist]")}`,
    "              [--slack-account <id> --slack-app-token <ENV_NAME|${ENV_NAME}|literal> --slack-bot-token <ENV_NAME|${ENV_NAME}|literal>]...",
    "              [--telegram-account <id> --telegram-bot-token <ENV_NAME|${ENV_NAME}|literal>]...",
    ...(cliName === DEFAULT_CLISBOT_CLI_NAME ? ["  clis <same-command>"] : []),
    `  ${renderCliCommand("--help")}`,
    "",
    "Commands:",
    `  start              Seed ${configPath} if missing, apply explicit bot bootstrap intent, and start clisbot in the background.`,
    `                     See ${renderCliCommand("start --help", { inline: true })} for bootstrap-focused flags and examples.`,
    "  restart            Stop the running clisbot process, then start it again.",
    "  stop               Stop the running clisbot process.",
    "  stop --hard        Stop clisbot and kill all tmux sessions on the configured clisbot socket.",
    "  status             Show runtime process, config, log, tmux socket status, and recent runner sessions.",
    "  version            Show the installed clisbot version.",
    "  logs               Print the most recent clisbot log lines.",
    "  update             Print the AI-readable package update guide and release/migration doc links.",
    `                     See ${renderCliCommand("update --help", { inline: true })} before asking an agent to update clisbot.`,
    "  timezone           Manage the app-wide wall-clock timezone used by schedules and loops.",
    `                     See ${renderCliCommand("timezone --help", { inline: true })} for override guidance.`,
    "  bots               Manage provider bot identities, credentials, and bot-level fallback settings.",
    "                     list|add|get|enable|disable|remove|get-default|set-default",
    "                     get-agent|set-agent|clear-agent",
    "                     get-credentials-source|set-credentials",
    "                     get-dm-policy|set-dm-policy",
    `                     See ${renderCliCommand("bots --help", { inline: true })} for examples and credential behavior.`,
    "  routes             Manage admitted inbound surfaces under each bot.",
    "                     list|add|get|enable|disable|remove",
    "                     get-agent|set-agent|clear-agent",
    "                     get-policy|set-policy",
    "                     get-require-mention|set-require-mention",
    "                     get-allow-bots|set-allow-bots",
    "                     add/remove allow-user|block-user",
    "                     get/set follow-up mode and ttl",
    "                     get/set/clear response mode and additional-message mode",
    `                     See ${renderCliCommand("routes --help", { inline: true })} for route ids and examples.`,
    "  loops              Create, inspect, or cancel managed loops with routed session context or app-wide inventory views.",
    "                     list|status",
    "                     create --channel <slack|telegram> --target <route> [--thread-id <slack-thread-ts>] [--topic-id <telegram-topic-id>] [--new-thread] <expression>",
    "                     cancel <id>|--all",
    "                     scoped status/cancel also accept --channel/--target/--thread-id/--topic-id",
    "                     `--target` selects the routed surface; use `--thread-id` for Slack threads, `--topic-id` for Telegram topics",
    `                     See ${renderCliCommand("loops --help", { inline: true })} for slash-compatible expressions and examples.`,
    "  message            Run provider message actions such as send, react, read, edit, delete, and pins.",
    `                     See ${renderCliCommand("message --help", { inline: true })} for channel-specific syntax.`,
    "  agents             Manage configured agents, workspaces, bootstrap files, and per-agent mode overrides.",
    `                     See ${renderCliCommand("agents --help", { inline: true })} for focused add/bootstrap help.`,
    `  auth               Manage app and agent auth roles, principals, and permissions in config. See ${renderCliCommand("auth --help", { inline: true })}.`,
    "  runner             Inspect tmux-backed runner sessions and validate runner smoke contracts.",
    "                     list|inspect <session-name>|watch <session-name>|watch --latest|watch --next|smoke ...",
    `                     See ${renderCliCommand("runner --help", { inline: true })} for operator debug and smoke details.`,
    `  runner shortcuts   ${renderCliCommand("runner list", { inline: true })} and ${renderCliCommand("runner watch --latest", { inline: true })} are the fastest tmux debug entry points.`,
    `  pairing            Run the pairing control CLI. See ${renderCliCommand("pairing --help", { inline: true })}.`,
    `  init               Seed ${configPath} and optionally create the first agent without starting clisbot.`,
    `                     See ${renderCliCommand("init --help", { inline: true })} for bootstrap-focused flags and examples.`,
    "  --version, -v      Show the installed clisbot version.",
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

function parseLineCount(args: string[]) {
  const defaultLines = 200;
  const index = args.findIndex((arg) => arg === "--lines" || arg === "-n");
  if (index === -1) {
    return defaultLines;
  }

  const rawValue = args[index + 1];
  const parsed = Number.parseInt(rawValue ?? "", 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid line count: ${rawValue ?? ""}`);
  }

  return parsed;
}
