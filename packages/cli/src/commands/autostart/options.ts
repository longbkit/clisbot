import { Command } from "commander";
import { addJsonOption } from "../../utils/command-options.js";
import { AUTOSTART_TARGET_NAMES, collectOption } from "./targets.js";

export function addTargetOptions(command: Command): Command {
  return addJsonOption(command)
    .option(
      "--home <path>",
      "Home directory to serve (default: $PASEO_HOME, $CLISBOT_HOME, then ~/.paseo)",
    )
    .option("--label-prefix <id>", "launchd label prefix (default: sh.paseo)")
    .option(
      "--target <name>",
      `Autostart target: ${AUTOSTART_TARGET_NAMES.join(", ")} (repeatable)`,
      collectOption,
      [],
    );
}
