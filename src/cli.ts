import { REPO_HELP_HINT, USER_GUIDE_DOC_PATH } from "./control/startup-bootstrap.ts";
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
  | { name: "channels"; args: string[] }
  | { name: "accounts"; args: string[] }
  | { name: "loops"; args: string[] }
  | { name: "message"; args: string[] }
  | { name: "agents"; args: string[] }
  | { name: "auth"; args: string[] }
  | { name: "pairing"; args: string[] }
  | { name: "init"; args: string[] }
  | { name: "serve-foreground" };

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

  throw new Error(`Unknown command: ${command}`);
}

export function renderCliHelp() {
  const configPath = collapseHomePath(getDefaultConfigPath());
  return [
    `clisbot v${getClisbotVersion()}`,
    "",
    "Fastest start:",
    "  1. Choose the channels you want to bootstrap explicitly.",
    "  2. Run one of these commands:",
    "     clisbot start --cli codex --bot-type personal --telegram-bot-token TELEGRAM_BOT_TOKEN",
    "     clisbot start --cli codex --bot-type personal --telegram-bot-token \"$TELEGRAM_BOT_TOKEN\" --persist",
    "     clisbot start --cli codex --bot-type team --slack-app-token SLACK_APP_TOKEN --slack-bot-token SLACK_BOT_TOKEN",
    "  3. Use `clisbot status` to see the config path, log path, tmux socket, and runtime state.",
    "",
    "Bot types:",
    "  personal  One human gets one dedicated long-lived assistant workspace and session path.",
    "  team      One shared channel or group routes into one shared assistant workspace and session path.",
    "",
    "Credential input rules:",
    "  Pass ENV_NAME or ${ENV_NAME} to keep the account env-backed.",
    "  Pass a raw or shell-expanded token value to use credentialType=mem for the current runtime only.",
    "  Raw token input on `start` is only for cold start unless you also pass --persist.",
    "  Fresh bootstrap only enables channels named by flags; ambient env vars alone do not auto-enable extra channels.",
    "",
    "Usage:",
    "  clisbot start [--cli <codex|claude|gemini>] [--bot-type <personal|team>] [--persist]",
    "               [--slack-account <id> --slack-app-token <ENV_NAME|${ENV_NAME}|literal> --slack-bot-token <ENV_NAME|${ENV_NAME}|literal>]...",
    "               [--telegram-account <id> --telegram-bot-token <ENV_NAME|${ENV_NAME}|literal>]...",
    "  clisbot restart",
    "  clisbot stop [--hard]",
    "  clisbot status",
    "  clisbot version",
    "  clisbot logs [--lines N]",
    "  clisbot channels <subcommand>",
    "  clisbot accounts <subcommand>",
    "  clisbot loops <subcommand>",
    "  clisbot message <subcommand>",
    "  clisbot agents <subcommand>",
    "  clisbot auth <subcommand>",
    "  clisbot pairing <subcommand>",
    "  clisbot init [--cli <codex|claude|gemini>] [--bot-type <personal|team>] [--persist]",
    "              [--slack-account <id> --slack-app-token <ENV_NAME|${ENV_NAME}|literal> --slack-bot-token <ENV_NAME|${ENV_NAME}|literal>]...",
    "              [--telegram-account <id> --telegram-bot-token <ENV_NAME|${ENV_NAME}|literal>]...",
    "  clis <same-command>",
    "  clisbot --help",
    "",
    "Commands:",
    `  start              Seed ${configPath} if missing, apply explicit channel-account bootstrap intent, and start clisbot in the background.`,
    "  restart            Stop the running clisbot process, then start it again.",
    "  stop               Stop the running clisbot process.",
    "  stop --hard        Stop clisbot and kill all tmux sessions on the configured clisbot socket.",
    "  status             Show runtime process, config, log, and tmux socket status.",
    "  version            Show the installed clisbot version.",
    "  logs               Print the most recent clisbot log lines.",
    "  channels           Manage channel enablement, routes, and token references in config.",
    "                     enable|disable <slack|telegram>",
    "                     add telegram-group <chatId> [--topic <topicId>] [--agent <id>] [--require-mention true|false]",
    "                     remove telegram-group <chatId> [--topic <topicId>]",
    "                     add slack-channel <channelId> [--agent <id>] [--require-mention true|false]",
    "                     remove slack-channel <channelId>",
    "                     add slack-group <groupId> [--agent <id>] [--require-mention true|false]",
    "                     remove slack-group <groupId>",
    "                     set-token <slack-app|slack-bot|telegram-bot> <value>",
    "                     clear-token <slack-app|slack-bot|telegram-bot>",
    "  accounts           Manage Slack and Telegram provider accounts plus persistence state.",
    "                     add telegram --account <id> --token <ENV_NAME|${ENV_NAME}|literal> [--persist]",
    "                     add slack --account <id> --app-token <ENV_NAME|${ENV_NAME}|literal> --bot-token <ENV_NAME|${ENV_NAME}|literal> [--persist]",
    "                     persist --channel <slack|telegram> --account <id>",
    "                     persist --all",
    "  loops              Inspect or cancel managed recurring loops persisted by `/loop`.",
    "                     list|status",
    "                     cancel <id>",
    "                     cancel --all",
    "  message            Run provider message actions such as send, react, read, edit, delete, and pins.",
    "  agents             Manage configured agents and top-level bindings.",
    "  auth               Manage app and agent auth roles, principals, and permissions in config. See `clisbot auth --help`.",
    "  pairing            Run the pairing control CLI.",
    `  init               Seed ${configPath} and optionally create the first agent without starting clisbot.`,
    "  --version, -v      Show the installed clisbot version.",
    "  --help             Show this help text.",
    "",
    "Package usage:",
    "  npx clisbot start",
    "  npm install -g clisbot && clisbot start",
    "  npm install -g clisbot && clis start",
    "",
    "More info:",
    `  Docs: ${USER_GUIDE_DOC_PATH}`,
    `  ${REPO_HELP_HINT}`,
  ].join("\n");
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
