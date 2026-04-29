import { parseCliArgs, renderCliHelp } from "./cli.ts";
import { runPairingCli } from "./channels/pairing/cli.ts";
import { runAgentsCli } from "./control/agents-cli.ts";
import { runAccountsCli } from "./control/accounts-cli.ts";
import { runAuthCli } from "./control/auth-cli.ts";
import { runBotsCli } from "./control/bots-cli.ts";
import { runChannelsCli } from "./control/channels-cli.ts";
import { runLoopsCli } from "./control/loops-cli.ts";
import { runMessageCli } from "./control/message-cli.ts";
import { runRoutesCli } from "./control/routes-cli.ts";
import { runRunnerCli } from "./control/runner-cli.ts";
import { runTimezoneCli } from "./control/timezone-cli.ts";
import { runUpdateCli } from "./control/update-cli.ts";
import { initConfig, start } from "./control/runtime-bootstrap-cli.ts";
import {
  logs,
  printCliError,
  restart,
  serveForeground,
  serveRuntimeMonitor,
  status,
  stop,
} from "./control/runtime-management-cli.ts";
import {
  assertSupportedPlatform,
  getCliErrorExitCode,
  printCommandOutcomeBanner,
} from "./control/runtime-cli-shared.ts";
import { setRenderedCliName } from "./shared/cli-name.ts";
import { getClisbotVersion } from "./version.ts";

const INTERNAL_CLI_NAME_FLAG = "--internal-cli-name";

export function prepareCliArgv(argv: string[]) {
  const flagIndex = argv.findIndex((arg) => arg === INTERNAL_CLI_NAME_FLAG);
  if (flagIndex === -1) {
    setRenderedCliName(process.env.CLISBOT_CLI_NAME);
    return argv;
  }

  const cliName = argv[flagIndex + 1];
  setRenderedCliName(cliName);

  if (cliName == null) {
    return argv.filter((arg) => arg !== INTERNAL_CLI_NAME_FLAG);
  }

  return argv.filter((_, index) => index !== flagIndex && index !== flagIndex + 1);
}

async function runBuiltinCommand(command: ReturnType<typeof parseCliArgs>) {
  if (command.name === "help") {
    console.log(renderCliHelp());
    return true;
  }

  if (command.name === "version") {
    console.log(getClisbotVersion());
    return true;
  }

  if (command.name === "init") {
    await initConfig(command.args);
    return true;
  }

  if (command.name === "serve-foreground") {
    await serveForeground();
    return true;
  }

  if (command.name === "serve-monitor") {
    await serveRuntimeMonitor();
    return true;
  }

  if (command.name === "start") {
    await start(command.args);
    return true;
  }

  if (command.name === "restart") {
    await restart();
    await start();
    return true;
  }

  if (command.name === "stop") {
    await stop(command.hard);
    return true;
  }

  if (command.name === "status") {
    await status();
    return true;
  }

  if (command.name === "logs") {
    await logs(command.lines);
    return true;
  }

  if (command.name === "update") {
    await runUpdateCli(command.args);
    return true;
  }

  return false;
}

async function runControlCommand(command: ReturnType<typeof parseCliArgs>) {
  if (command.name === "channels") {
    await runChannelsCli(command.args);
    return true;
  }

  if (command.name === "timezone") {
    await runTimezoneCli(command.args);
    return true;
  }

  if (command.name === "bots") {
    await runBotsCli(command.args);
    return true;
  }

  if (command.name === "routes") {
    await runRoutesCli(command.args);
    return true;
  }

  if (command.name === "accounts") {
    await runAccountsCli(command.args);
    return true;
  }

  if (command.name === "loops") {
    await runLoopsCli(command.args);
    return true;
  }

  if (command.name === "message") {
    await runMessageCli(command.args);
    return true;
  }

  if (command.name === "agents") {
    await runAgentsCli(command.args);
    return true;
  }

  if (command.name === "auth") {
    await runAuthCli(command.args);
    return true;
  }

  if (command.name === "runner") {
    await runRunnerCli(command.args);
    return true;
  }

  if (command.name === "pairing") {
    await runPairingCli(command.args);
    return true;
  }

  return false;
}

async function main(command = parseCliArgs(prepareCliArgv(process.argv))) {
  assertSupportedPlatform(command);

  if (await runBuiltinCommand(command)) {
    return;
  }

  await runControlCommand(command);
}

const command = parseCliArgs(prepareCliArgv(process.argv));

try {
  await main(command);
} catch (error) {
  if (command.name === "start" || command.name === "stop" || command.name === "restart") {
    printCommandOutcomeBanner("failure");
  }
  await printCliError(error);
  process.exit(getCliErrorExitCode(error));
}
