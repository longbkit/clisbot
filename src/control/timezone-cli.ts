import { readEditableConfig, writeEditableConfig } from "../config/config-file.ts";
import {
  formatTimezoneLocalTime,
  getHostTimezone,
  parseTimezone,
  resolveConfigTimezone,
} from "../config/timezone.ts";
import { renderCliCommand } from "../shared/cli-name.ts";

function getEditableConfigPath() {
  return process.env.CLISBOT_CONFIG_PATH;
}

function renderTimezoneHelp() {
  return [
    renderCliCommand("timezone"),
    "",
    "Usage:",
    `  ${renderCliCommand("timezone --help")}`,
    `  ${renderCliCommand("timezone get")}`,
    `  ${renderCliCommand("timezone set <iana-timezone>")}`,
    `  ${renderCliCommand("timezone clear")}`,
    `  ${renderCliCommand("timezone doctor")}`,
    "",
    "Examples:",
    `  ${renderCliCommand("timezone set Asia/Ho_Chi_Minh")}`,
    `  ${renderCliCommand("timezone set America/Los_Angeles")}`,
    "",
    "Behavior:",
    "  - app timezone is the default for wall-clock loops when no agent, route, or bot override exists",
    "  - use agent timezone when one workspace/assistant mostly serves a different timezone",
    "  - use route timezone when one Slack/Telegram surface needs different wall-clock time",
    "  - use bot timezone only as an advanced fallback for a concrete provider bot",
  ].join("\n");
}

export async function runTimezoneCli(args: string[]) {
  const action = args[0];
  if (!action || action === "--help" || action === "-h" || action === "help") {
    console.log(renderTimezoneHelp());
    return;
  }

  const { config, configPath } = await readEditableConfig(getEditableConfigPath());
  if (action === "get") {
    const resolved = resolveConfigTimezone({ config });
    console.log(`app.timezone: ${config.app.timezone ?? "(unset)"}`);
    console.log(`effective: ${resolved.timezone} (${resolved.source})`);
    console.log(`localTime: ${formatTimezoneLocalTime(resolved.timezone)}`);
    console.log(`host: ${getHostTimezone()}`);
    console.log(`config: ${configPath}`);
    return;
  }

  if (action === "set") {
    const timezone = parseTimezone(args[1]);
    config.app.timezone = timezone;
    await writeEditableConfig(configPath, config);
    console.log(`set app.timezone to ${timezone}`);
    console.log(`config: ${configPath}`);
    return;
  }

  if (action === "clear") {
    delete config.app.timezone;
    await writeEditableConfig(configPath, config);
    const resolved = resolveConfigTimezone({ config });
    console.log("cleared app.timezone");
    console.log(`effective: ${resolved.timezone} (${resolved.source})`);
    console.log(`config: ${configPath}`);
    return;
  }

  if (action === "doctor") {
    const resolved = resolveConfigTimezone({ config });
    console.log(`effective: ${resolved.timezone} (${resolved.source})`);
    console.log(`localTime: ${formatTimezoneLocalTime(resolved.timezone)}`);
    console.log(`app.timezone: ${config.app.timezone ?? "(unset)"}`);
    console.log(`host: ${getHostTimezone()}`);
    console.log(`config: ${configPath}`);
    return;
  }

  throw new Error(renderTimezoneHelp());
}
